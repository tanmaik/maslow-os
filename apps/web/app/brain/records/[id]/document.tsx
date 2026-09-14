"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Button } from "@/components/base/buttons/button";
import { Textarea } from "@/components/base/textarea/textarea";

import { Body } from "./body";
import { useLive } from "./live";
import { lastChange, save } from "./save";

// How often a page asks whether the record changed elsewhere.
const WATCH = 3000;

// A name's first letters, for a small round mark.
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

// A record as a document: a title and a body a person edits where they
// read them, kept as they leave each one. The body takes its shape as it
// is typed and is stored as markdown, which is what an agent writes. Every
// save names the change the value it replaces rested on, so one that fell
// behind is refused rather than overwriting; the page then shows the newer
// version and the person keeps theirs or takes it. The page watches the
// log and refreshes as the record changes elsewhere.
export function Document({
  id,
  title,
  body,
  seen,
  canEdit,
  me,
  liveable,
  fields,
}: {
  id: string;
  title: string;
  body: string;
  // The number of the last change to the record the page was read with.
  seen: number;
  canEdit: boolean;
  // The reader, for their caret and for the row of who else is here.
  me: { id: string; name: string };
  // Whether this deployment has a relay to join the body to.
  liveable: boolean;
  // What the record holds beside its words, which reads under them: a
  // record is a document, and a document's first paragraph follows its
  // title.
  fields?: ReactNode;
}) {
  const router = useRouter();
  const { live, status, others } = useLive(id, liveable, canEdit, me.id);
  const [heading, setHeading] = useState(title);
  const [trouble, setTrouble] = useState<string | null>(null);
  // What a save that fell behind was saving, per field, held until the
  // person keeps it or takes what arrived instead.
  const [clash, setClash] = useState<{ title?: string; body?: string }>({});
  // Which fields have a save out, while which the choice waits.
  const [saving, setSaving] = useState<{ title?: true; body?: true }>({});
  // A body the person chose, to be put in the text whether or not they are
  // in it: the page's, or their own kept over it. Counted so each choice
  // is put once.
  const [put, setPut] = useState<{
    n: number;
    body: string;
    seen: number;
  } | null>(null);
  const putBody = (body: string, seen: number) =>
    setPut((p) => ({ n: (p?.n ?? 0) + 1, body, seen }));
  // What the person dropped for the page's version while its save was
  // still out, so that save falling behind is not held again.
  const dropped = useRef<{ title?: string; body?: string }>({});
  const last = useRef(seen);
  last.current = seen;
  // The page's title, body and change as they are now, for a handler
  // made earlier.
  const page = useRef({ title, body, seen });
  page.current = { title, body, seen };
  // The change the title on screen rests on: moved when the page's title
  // is taken, and when one of the person's own lands.
  const titleBase = useRef(seen);
  // The title on screen, readable the moment it is set.
  const headingNow = useRef(title);
  const show = (t: string) => {
    headingNow.current = t;
    setHeading(t);
  };

  // Saves of a field go one after another, so none lands out of order. A
  // change that did not save is said, and put back to the last that did,
  // unless the person has typed on since.
  const saves = useRef<{
    title: Promise<number | "behind" | null>;
    body: Promise<number | "behind" | null>;
  }>({ title: Promise.resolve(null), body: Promise.resolve(null) });
  const kept = useRef({ title, body });
  const queued = useRef({ title, body });
  // How many saves of each field are still out, since what the page says
  // is behind them and must not be taken for what was asked for.
  const flight = useRef({ title: 0, body: 0 });
  // The change each field's last landed save made, which a save queued
  // behind it rests on rather than on what the page said before.
  const landedAt = useRef({ title: 0, body: 0 });
  // Saves a field's value, naming the change it rests on, and answers
  // with the record's last change once it landed, "behind" when the record
  // changed since, or null.
  const keep = (
    field: "title" | "body",
    value: string,
    base: number,
  ): Promise<number | "behind" | null> => {
    // A value already on its way answers with what that save does, not with
    // a success it has not had yet.
    if (value === queued.current[field]) return saves.current[field];
    queued.current[field] = value;
    flight.current[field] += 1;
    setSaving((s) => ({ ...s, [field]: true }));
    delete dropped.current[field];
    const done = saves.current[field].then(async () => {
      const rests = Math.max(base, landedAt.current[field]);
      const landed = await save(id, { [field]: value, seen: String(rests) });
      const said = typeof landed === "number" ? null : landed;
      setTrouble(said && !said.behind ? said.said : null);
      if (said) {
        // A save that fell behind is held while the newer version is
        // fetched; the person decides. A title that would not save goes
        // back to the last that did, unless the person has typed on since;
        // a body that would not save stays on screen and the trouble is
        // said above it.
        if (said.behind) {
          if (dropped.current[field] !== value)
            setClash((c) => ({ ...c, [field]: value }));
          router.refresh();
        }
        if (field === "title" && headingNow.current === value)
          show(kept.current.title);
        if (queued.current[field] === value)
          queued.current[field] = kept.current[field];
        return said.behind ? "behind" : null;
      }
      kept.current[field] = value;
      landedAt.current[field] = landed as number;
      if (field === "title") titleBase.current = landed as number;
      setClash(({ [field]: _, ...rest }) => rest);
      router.refresh();
      return landed as number;
    });
    void done.finally(() => {
      flight.current[field] -= 1;
      if (flight.current[field] === 0)
        setSaving(({ [field]: _, ...rest }) => rest);
      follow();
    });
    saves.current[field] = done;
    return done;
  };

  // A record rewritten elsewhere is what the next save is measured
  // against, so a person who types it back to what it was still saves.
  // The title shown follows it too, and rests on the page's change, unless
  // the person has typed one of their own that has not saved. Followed
  // whenever the page changes, and once a save has settled.
  // A page older than a save that landed is not followed: the refresh
  // that save asked for is still on its way.
  const follow = () => {
    const { title, body, seen } = page.current;
    if (flight.current.title === 0 && seen >= landedAt.current.title) {
      if (headingNow.current === kept.current.title) {
        show(title);
        titleBase.current = seen;
      }
      kept.current.title = title;
      queued.current.title = title;
    }
    if (flight.current.body === 0 && seen >= landedAt.current.body) {
      kept.current.body = body;
      queued.current.body = body;
    }
  };
  useEffect(follow, [title, body, seen]);

  // The record as it is elsewhere: while the page is in view, it asks the
  // log every few seconds and refreshes when the record has changed.
  useEffect(() => {
    let asking = false;
    const ask = async () => {
      if (asking || document.visibilityState !== "visible") return;
      asking = true;
      const now = await lastChange(id);
      asking = false;
      if (now !== null && now > last.current) router.refresh();
    };
    const timer = setInterval(() => void ask(), WATCH);
    document.addEventListener("visibilitychange", ask);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [id, router]);

  // Keeping what fell behind saves it over what arrived; the bar stays
  // until that lands, so a save that fails leaves the choice open.
  const keepMine = (field: "title" | "body") => {
    const mine = clash[field];
    if (mine === undefined) return;
    // What arrived says the same: there is nothing to save over.
    if (mine === page.current[field]) return takeTheirs(field);
    if (field === "title") show(mine);
    else putBody(mine, last.current);
    void keep(field, mine, last.current);
  };
  // Taking what arrived drops what fell behind, in the text as well.
  const takeTheirs = (field: "title" | "body") => {
    setClash(({ [field]: _, ...rest }) => rest);
    if (flight.current[field] > 0)
      dropped.current[field] = queued.current[field];
    if (field === "title") {
      show(page.current.title);
      titleBase.current = page.current.seen;
      kept.current.title = page.current.title;
      queued.current.title = page.current.title;
    } else putBody(page.current.body, page.current.seen);
  };

  return (
    <div className="flex flex-1 flex-col gap-3">
      {canEdit ? (
        <Textarea
          size="small"
          aria-label="Title"
          rows={1}
          autoResize
          value={heading}
          onChange={(v) => show(v.replace(/\n/g, " "))}
          onBlur={() => {
            show(heading.trim());
            void keep("title", heading.trim(), titleBase.current);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          placeholder="Untitled"
          fieldClassName="rounded-none bg-transparent p-0 ring-0 [&_textarea]:px-0 [&_textarea]:text-title-1-semibold [&_textarea]:text-text-primary"
        />
      ) : (
        <h1 className="text-title-1-semibold text-text-primary">
          {title || "(untitled)"}
        </h1>
      )}
      {(["title", "body"] as const).map(
        (field) =>
          clash[field] !== undefined && (
            <div
              key={field}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border-button-default bg-background-secondary-default px-3 py-2"
            >
              <p className="flex-1 text-body-regular text-text-primary">
                The {field} changed while you were writing. This is the newer
                version.
              </p>
              <div className="flex gap-1">
                <Button
                  size="small"
                  variant="secondary"
                  disabled={saving[field]}
                  onClick={() => keepMine(field)}
                >
                  Keep mine
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={saving[field]}
                  onClick={() => takeTheirs(field)}
                >
                  Take this
                </Button>
              </div>
            </div>
          ),
      )}
      {(others.length > 0 || (liveable && status === "off")) && (
        <div className="flex flex-wrap items-center gap-2 text-caption-1-regular text-text-secondary">
          {others.length > 0 && (
            <span className="flex -space-x-1.5">
              {others.map((o) => (
                <Avatar
                  key={o.id}
                  size="sm"
                  initials={initials(o.name)}
                  style={{ background: o.color }}
                  className="ring-2 ring-background-primary-default"
                />
              ))}
            </span>
          )}
          {others.length > 0 && (
            <span>
              {others.map((o) => o.name).join(", ")}{" "}
              {others.length === 1 ? "is" : "are"} here
            </span>
          )}
          {status === "off" && <Badge>Not live</Badge>}
        </div>
      )}
      <Body
        body={body}
        seen={seen}
        put={put}
        canEdit={canEdit}
        live={live}
        joining={status === "joining"}
        me={me}
        onKeep={(t, base) => keep("body", t, base)}
      />
      {fields}
      {trouble && (
        <p className="text-body-regular text-text-error-primary">{trouble}</p>
      )}
    </div>
  );
}
