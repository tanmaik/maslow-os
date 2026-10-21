"use client";

import { RiSearchLine } from "@remixicon/react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";

import { Unlink } from "./unlink";

// One record this one is linked to under one verb: where it opens, what it
// is called, whose it is when it is a colleague's, and the links it stands
// for, since two links with the same verb to the same record are one chip.
type LinkChip = {
  id: string;
  href: string;
  title: string;
  whose: string | null;
  edges: string[];
};

// The links under one verb, pointing out from this record or in to it.
export type LinkGroup = {
  key: string;
  verb: string;
  incoming: boolean;
  chips: LinkChip[];
};

// How many chips a group shows before the rest fold, and how many links
// in all before a search box stands over them.
const SHOWN = 8;
const SEARCHED = 40;

// The records this one is linked to, grouped under their verbs with a
// count on each, the first few of each group shown and the rest behind
// how many they are, and a search over their names once there are more
// than a hand can scan. A record with a few links looks as it always has.
export function LinkGroups({
  groups,
  action,
  back,
  canEdit,
}: {
  groups: LinkGroup[];
  action: string;
  back: string;
  canEdit: boolean;
}) {
  const [wanted, setWanted] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const total = groups.reduce((n, g) => n + g.chips.length, 0);
  const word = wanted.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      chips: word
        ? g.chips.filter((c) => c.title.toLowerCase().includes(word))
        : g.chips,
    }))
    .filter((g) => g.chips.length > 0);
  // With few links there is nothing to group: the chips lie in one row.
  const flat = groups.length === 1 && total <= SHOWN;
  return (
    <div className="flex flex-col gap-3">
      {total > SEARCHED && (
        <Input
          size="small"
          value={wanted}
          onChange={setWanted}
          placeholder="Search links"
          aria-label="Search links"
          leadingIcon={RiSearchLine}
          className="max-w-xs"
        />
      )}
      {word && shown.length === 0 && (
        <p className="text-caption-1-regular text-text-tertiary">No results.</p>
      )}
      {shown.map((g) => {
        const open = opened.has(g.key) || !!word;
        const chips = open ? g.chips : g.chips.slice(0, SHOWN);
        return (
          <div key={g.key} className="flex flex-col gap-1.5">
            {!flat && (
              <p className="flex items-baseline gap-1.5 text-caption-1-medium text-text-tertiary">
                <span>
                  {g.incoming && (
                    <span aria-label="from another record" className="mr-1">
                      ←
                    </span>
                  )}
                  {g.verb}
                </span>
                <span className="tabular-nums">{g.chips.length}</span>
              </p>
            )}
            <ul className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <li
                  key={c.id}
                  className="group flex h-8 items-center gap-1.5 rounded-full bg-background-secondary-default pr-1.5 pl-3"
                >
                  <Link
                    href={c.href}
                    className="max-w-64 truncate text-body-medium text-text-primary hover:underline"
                  >
                    {c.title}
                  </Link>
                  {c.whose && (
                    <span className="text-caption-2-regular text-text-secondary">
                      {c.whose}
                    </span>
                  )}
                  {canEdit ? (
                    <Unlink
                      action={action}
                      back={back}
                      edges={c.edges}
                      title={c.title}
                      verb={g.verb}
                    />
                  ) : (
                    <span className="w-1" />
                  )}
                </li>
              ))}
              {g.chips.length > chips.length && (
                <li>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => setOpened((was) => new Set(was).add(g.key))}
                  >
                    +{g.chips.length - chips.length} more
                  </Button>
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
