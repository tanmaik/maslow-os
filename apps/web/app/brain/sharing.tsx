"use client";

import type { Share, Subject, Target } from "@maslow/brain";
import type { Group } from "@maslow/db/groups";
import { RiGroupLine } from "@remixicon/react";

import { FormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";

import { Choose } from "./choose";
import { Required } from "./fields";

// A subject as a form value and back: "everyone", "public", "group:<id>",
// "member:<id>".
const value = (s: Subject) => ("id" in s ? `${s.who}:${s.id}` : s.who);

// The three levels, in the one set of words the brain uses for them
// everywhere: the dialog, the chips and the agent's asks.
export const MAY = { view: "view", edit: "edit", owner: "own" } as const;

// Whom a share is given to and what it lets them do: the two fields
// every share is made of, wherever it is asked for. Nothing is chosen to
// begin with — opening a record to the whole org is the most
// consequential act here, and is never a default.
export function ShareFields({
  members,
  groups,
}: {
  members: { id: string; name: string }[];
  // Everyone is not a group here: it is the last choice in the list.
  groups: { id: string; name: string }[];
}) {
  return (
    <>
      <Field>
        <FieldLabel>
          Share with
          <Required />
        </FieldLabel>
        <Choose
          name="subject"
          aria-label="Share with"
          placeholder="Choose people"
          required
          className="w-full"
          options={[
            ...members.map((m) => [`member:${m.id}`, m.name] as const),
            ...groups.map(
              (g) => [`group:${g.id}`, `${g.name} (group)`] as const,
            ),
            ["everyone", "Everyone in the org"] as const,
          ]}
        />
      </Field>
      <Field>
        <FieldLabel>Permission</FieldLabel>
        <Choose
          name="level"
          aria-label="Permission"
          defaultValue="view"
          className="w-full"
          options={[
            ["view", MAY.view],
            ["edit", MAY.edit],
            ["owner", MAY.owner],
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Everyone can only be given view. Editors can change; owners can also
          share, delete and merge.
        </p>
      </Field>
    </>
  );
}

// Who a record or a type is shared with, and, for its owner, a way to share
// it with a person, a group or everyone at a level. Sharing a type shares
// every record of it. As a pill, it is one button that says who can see it
// and opens on it; otherwise it is a line and a button beneath.
export function Sharing({
  on,
  owner,
  ownerName,
  shares,
  groups,
  members,
  pill = false,
}: {
  on: Target;
  owner: boolean;
  ownerName: string;
  shares: Share[];
  groups: Group[];
  members: { id: string; name: string }[];
  pill?: boolean;
}) {
  const what = "type" in on ? "type" : "record";
  const target =
    "type" in on
      ? { name: "type", value: on.type }
      : { name: "record", value: on.record };
  const name = (s: Subject) =>
    s.who === "everyone"
      ? "Everyone"
      : s.who === "public"
        ? "Anyone"
        : s.who === "group"
          ? (groups.find((g) => g.id === s.id)?.name ??
            "a group no longer here")
          : (members.find((m) => m.id === s.id)?.name ??
            "someone no longer here");
  const inside = (
    <div className="flex flex-col gap-4">
      <form action="/brain/share" method="post" className="grid gap-4">
        <input type="hidden" name={target.name} value={target.value} />
        <ShareFields
          members={members}
          groups={groups.filter((g) => !g.everyone)}
        />
        <div>
          <Button size="sm" type="submit">
            {what === "type"
              ? "Share this type, and every record of it"
              : "Share this record"}
          </Button>
        </div>
      </form>
      {shares.length > 0 && (
        <div className="flex flex-col border-t border-border">
          {shares.map((g) => (
            <div
              key={g.id}
              className="flex min-h-10 w-full items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm text-foreground">
                  {name(g.subject)}
                </span>
                <Badge variant="secondary">{MAY[g.level]}</Badge>
              </span>
              <form action="/brain/share" method="post">
                <input type="hidden" name="intent" value="unshare" />
                <input type="hidden" name={target.name} value={target.value} />
                <input type="hidden" name="subject" value={value(g.subject)} />
                <Button variant="outline" size="sm" type="submit">
                  Stop sharing
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Who it is open to, in as few words as a button holds: everyone, one
  // person by name, or how many.
  const said =
    shares.length === 0
      ? ownerName === "you"
        ? "Private"
        : `${ownerName}'s`
      : shares.some((g) => g.subject.who === "everyone")
        ? "Everyone"
        : shares.length === 1
          ? name(shares[0]!.subject)
          : `${shares.length} others`;
  const title = `Share this ${what}`;
  const description =
    what === "type"
      ? "Who may see every record of this type, change them, or do everything with them. The most any path gives someone is what they can do."
      : "Who may see it, change it, or do everything with it. The most any path gives someone is what they can do.";
  if (pill) {
    if (owner) {
      return (
        <FormDialog
          trigger={
            <>
              <RiGroupLine data-icon="inline-start" />
              {said}
            </>
          }
          className="shrink-0 text-muted-foreground"
          title={title}
          description={description}
        >
          {inside}
        </FormDialog>
      );
    }
    // Whose it is is already said beside its type, so this says only what
    // that does not: that someone else can see it too.
    if (shares.length === 0) return null;
    return (
      <span className="flex shrink-0 items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
        <RiGroupLine className="size-3.5" aria-hidden />
        {said}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        {shares.length === 0 ? (
          ownerName === "you" ? (
            "Only you can see this."
          ) : (
            `${ownerName}'s.`
          )
        ) : (
          <>
            {ownerName === "you" ? "Yours" : `${ownerName}'s`}
            {", shared with "}
            {shares.map((g, i) => (
              <span key={g.id}>
                {i > 0 && ", "}
                {name(g.subject)}{" "}
                <Badge variant="secondary">{MAY[g.level]}</Badge>
              </span>
            ))}
          </>
        )}
      </p>
      {owner && (
        <FormDialog trigger="Share" title={title} description={description}>
          {inside}
        </FormDialog>
      )}
    </div>
  );
}
