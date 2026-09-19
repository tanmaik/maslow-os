"use client";

import type { Share, Subject, Target } from "@maslow/brain";
import type { Group } from "@maslow/db/groups";
import { RiGroupLine } from "@remixicon/react";

import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Label } from "@/components/base/input/label";
import { Select, SelectItem } from "@/components/base/select/select";
import { SettingsCard } from "@/components/application/settings/settings-rows";
import { FormDialog } from "@/components/form-dialog";

import { FIELD } from "./format";

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
      <div className="flex flex-col gap-1.5">
        <Label isRequired>Share with</Label>
        <Select
          size="sm"
          name="subject"
          aria-label="Share with"
          placeholder="Choose people"
          isRequired
          triggerClassName={`w-full ${FIELD}`}
          popoverClassName="w-[var(--trigger-width)] max-w-none"
        >
          {members.map((m) => (
            <SelectItem key={m.id} id={`member:${m.id}`}>
              {m.name}
            </SelectItem>
          ))}
          {groups.map((g) => (
            <SelectItem key={g.id} id={`group:${g.id}`}>
              {g.name} (group)
            </SelectItem>
          ))}
          <SelectItem id="everyone">Everyone in the org</SelectItem>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Permission</Label>
        <Select
          size="sm"
          name="level"
          aria-label="Permission"
          defaultSelectedKey="view"
          triggerClassName={`w-full ${FIELD}`}
          popoverClassName="w-[var(--trigger-width)] max-w-none"
        >
          <SelectItem id="view">{MAY.view}</SelectItem>
          <SelectItem id="edit">{MAY.edit}</SelectItem>
          <SelectItem id="owner">{MAY.owner}</SelectItem>
        </Select>
        <p className="text-caption-1-regular text-text-secondary">
          Everyone can only be given view. Editors can change; owners can also
          share, delete and merge.
        </p>
      </div>
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
          <Button size="small" type="submit">
            {what === "type"
              ? "Share this type, and every record of it"
              : "Share this record"}
          </Button>
        </div>
      </form>
      {shares.length > 0 && (
        <SettingsCard>
          {shares.map((g) => (
            <div
              key={g.id}
              className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-separator-border py-2.5 pr-2.5 last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-body-regular text-text-primary">
                  {name(g.subject)}
                </span>
                <Chip variant="caption" color="soft">
                  {MAY[g.level]}
                </Chip>
              </span>
              <form action="/brain/share" method="post">
                <input type="hidden" name="intent" value="unshare" />
                <input type="hidden" name={target.name} value={target.value} />
                <input type="hidden" name="subject" value={value(g.subject)} />
                <Button variant="secondary" size="small" type="submit">
                  Stop sharing
                </Button>
              </form>
            </div>
          ))}
        </SettingsCard>
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
          trigger={said}
          leadingIcon={RiGroupLine}
          variant="secondary"
          className="shrink-0 gap-1 rounded-full px-2.5 text-text-secondary"
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
      <span className="flex shrink-0 items-center gap-1 px-1 text-caption-1-medium text-text-secondary">
        <RiGroupLine className="size-3.5" aria-hidden />
        {said}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-body-regular">
      <p className="text-text-secondary">
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
                <Chip variant="caption" color="soft">
                  {MAY[g.level]}
                </Chip>
              </span>
            ))}
          </>
        )}
      </p>
      {owner && (
        <FormDialog
          trigger="Share"
          variant="secondary"
          title={title}
          description={description}
        >
          {inside}
        </FormDialog>
      )}
    </div>
  );
}
