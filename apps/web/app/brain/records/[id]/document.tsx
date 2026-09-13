"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Textarea } from "@/components/ui/textarea";

import { Body } from "./body";
import { save } from "./save";

// A record as a document: a title and a body a person edits where they
// read them, kept as they leave each one. The body takes its shape as it
// is typed and is stored as markdown, which is what an agent writes.
export function Document({
  id,
  title,
  body,
  canEdit,
  fields,
}: {
  id: string;
  title: string;
  body: string;
  canEdit: boolean;
  // What the record holds beside its words, which reads between the title
  // and the body as it does on a page of notes.
  fields?: ReactNode;
}) {
  const router = useRouter();
  const [heading, setHeading] = useState(title);
  const [trouble, setTrouble] = useState<string | null>(null);

  // Saves of a field go one after another, so none lands out of order. A
  // change that did not save is said, and put back to the last that did,
  // unless the person has typed on since.
  const saves = useRef({
    title: Promise.resolve(true),
    body: Promise.resolve(true),
  });
  const kept = useRef({ title, body });
  const queued = useRef({ title, body });
  // How many saves of each field are still out, since what the page says
  // is behind them and must not be taken for what was asked for.
  const flight = useRef({ title: 0, body: 0 });
  const keep = (field: "title" | "body", value: string): Promise<boolean> => {
    // A value already on its way answers with what that save does, not with
    // a success it has not had yet.
    if (value === queued.current[field]) return saves.current[field];
    queued.current[field] = value;
    flight.current[field] += 1;
    const done = saves.current[field].then(async () => {
      const said = await save(id, { [field]: value });
      setTrouble(said);
      if (said) {
        // A title that would not save goes back to the last that did,
        // unless the person has typed on since; a body that would not save
        // stays on screen and the trouble is said above it.
        if (field === "title")
          setHeading((now) => (now === value ? kept.current.title : now));
        if (queued.current[field] === value)
          queued.current[field] = kept.current[field];
        return false;
      }
      kept.current[field] = value;
      router.refresh();
      return true;
    });
    void done.finally(() => {
      flight.current[field] -= 1;
    });
    saves.current[field] = done;
    return done;
  };

  // A record rewritten elsewhere is what the next save is measured
  // against, so a person who types it back to what it was still saves.
  // The title shown follows it too, unless the person has typed one of
  // their own that has not saved.
  useEffect(() => {
    if (flight.current.title === 0) {
      const was = kept.current.title;
      setHeading((now) => (now === was ? title : now));
      kept.current.title = title;
      queued.current.title = title;
    }
    if (flight.current.body === 0) {
      kept.current.body = body;
      queued.current.body = body;
    }
  }, [title, body]);

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      {canEdit ? (
        <Textarea
          aria-label="Title"
          rows={1}
          value={heading}
          onChange={(e) => setHeading(e.target.value.replace(/\n/g, " "))}
          onBlur={() => {
            setHeading(heading.trim());
            keep("title", heading.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder="Untitled"
          className="min-h-0 field-sizing-content resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[26px] leading-[32px] font-semibold tracking-[-0.015em] shadow-none focus-visible:ring-0 md:text-[26px] dark:bg-transparent"
        />
      ) : (
        <h1 className="text-[26px] leading-[32px] font-semibold tracking-[-0.015em]">
          {title || "(untitled)"}
        </h1>
      )}
      {fields}
      <Body body={body} canEdit={canEdit} onKeep={(t) => keep("body", t)} />
      {trouble && <p className="text-destructive text-sm">{trouble}</p>}
    </div>
  );
}
