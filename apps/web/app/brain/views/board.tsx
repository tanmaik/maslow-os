"use client";

import { motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button, buttonStyles } from "@/components/base/buttons/button";
import {
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { LocalTime } from "@/components/local-time";
import { cx } from "@/utils/cx";

import { recordHref, recordPageHref } from "../format";
import { useHere } from "../here";
import { SAID } from "../refuse";
import type { Row } from "./query";

const TRIGGER = cx(
  buttonStyles.base,
  buttonStyles.size.small,
  buttonStyles.variant.secondary,
);

// One column of the board: a value the chosen field can hold, the records
// that hold it, and how many there are in all. The last column is the
// records with no value at all.
export type Lane = {
  value: string | null;
  label: string;
  held: number;
  rows: Row[];
};

// The records of one type laid out under the values of one of its choice
// fields, with a card moved from column to column to change that value.
export function BoardView({
  lanes,
  group,
  choices,
  canWrite,
}: {
  lanes: Lane[];
  group: string;
  // Every choice field this type declares, since any of them could be the
  // columns.
  choices: string[];
  // A colleague's records are read here and never moved.
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const here = useHere();
  // A card moved but not yet answered for, so the board reads as the person
  // left it while the door is still writing. A move belongs to the field it
  // was made under: a value of one field means nothing under another.
  const [moved, setMoved] = useState<
    Record<string, { group: string; to: string | null }>
  >({});
  const [carrying, setCarrying] = useState<string | null>(null);
  // Whether the menu of what the columns are is open; a pick closes it.
  const [choosing, setChoosing] = useState(false);
  // When the last drag ended, so the release that finished it never opens
  // the record whose title it started on.
  const dropped = useRef(0);

  const go = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    change(next);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  // What the field is worth now: what the person just dragged it to, or
  // what the door last said.
  const at = (r: Row) => {
    const m = moved[r.id];
    return m?.group === group ? m.to : ((r.props[group] as string) ?? null);
  };

  // A move stands only until the door's answer comes back with it: a card
  // the board now shows where the person put it forgets its move, and so
  // does one made under a field the columns are no longer.
  useEffect(() => {
    setMoved((m) => {
      const rows = lanes.flatMap((l) => l.rows);
      const left = Object.entries(m).filter(([id, mv]) =>
        rows.some(
          (r) =>
            r.id === id &&
            mv.group === group &&
            ((r.props[group] as string) ?? null) !== mv.to,
        ),
      );
      return left.length === Object.keys(m).length
        ? m
        : Object.fromEntries(left);
    });
  }, [lanes, group]);

  const held = (lane: Lane) =>
    lanes
      .flatMap((l) => l.rows)
      .filter((r) => at(r) === lane.value)
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  // The value moves through the same door an edit goes through, named the
  // same way, so moving a card twice to one column writes once.
  const move = async (id: string, to: string | null) => {
    const was = at(lanes.flatMap((l) => l.rows).find((r) => r.id === id)!);
    if (was === to) return;
    setMoved((m) => ({ ...m, [id]: { group, to } }));
    const body = new FormData();
    body.set(`p.${group}`, to ?? "");
    const said = await fetch(`${recordHref(id)}/change`, {
      method: "post",
      body,
      headers: { accept: "application/json" },
    });
    if (!said.ok) {
      setMoved((m) => ({ ...m, [id]: { group, to: was } }));
      // What a door says is a phrase; what a person reads is a sentence.
      const why = await said.text();
      const next = new URLSearchParams(params.toString());
      next.set(SAID, why.charAt(0).toUpperCase() + why.slice(1));
      router.replace(`${pathname}?${next}`, { scroll: false });
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 px-3 pb-3">
      <div className="flex items-center gap-2">
        <span className="text-caption-1-semibold text-text-secondary">
          Group by
        </span>
        {choices.length > 1 ? (
          <Dropdown isOpen={choosing} onOpenChange={setChoosing}>
            <DropdownTrigger aria-label="Group by" className={TRIGGER}>
              <span className={buttonStyles.label.small}>{group}</span>
            </DropdownTrigger>
            <DropdownPopover aria-label="Group by">
              <DropdownGroup>
                {choices.map((name) => (
                  <DropdownItem
                    key={name}
                    selected={name === group}
                    onSelect={() => {
                      setChoosing(false);
                      go((p) => p.set("group", name));
                    }}
                  >
                    {name}
                  </DropdownItem>
                ))}
              </DropdownGroup>
            </DropdownPopover>
          </Dropdown>
        ) : (
          <span className="text-caption-1-semibold text-text-secondary">
            {group}
          </span>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {lanes.map((lane) => {
          const rows = held(lane);
          return (
            <div
              key={lane.value ?? ""}
              data-lane={lane.value ?? ""}
              className={cx(
                "flex w-72 shrink-0 flex-col gap-2 rounded-2xl bg-background-secondary-default p-2 transition-colors duration-fast ease-plain",
                carrying && "outline-1 outline-separator-border",
              )}
            >
              <div className="flex items-center justify-between gap-2 px-1 py-1">
                <span className="truncate text-body-2-medium text-text-primary">
                  {lane.label}
                </span>
                <span className="text-caption-1-regular text-text-secondary tabular-nums">
                  {lane.held}
                </span>
              </div>
              {rows.length === 0 && (
                <p className="px-1 py-6 text-center text-caption-1-regular text-text-placeholder">
                  No records
                </p>
              )}
              {rows.map((r) => (
                <motion.div
                  key={r.id}
                  drag={canWrite}
                  dragSnapToOrigin
                  dragMomentum={false}
                  dragElastic={0.2}
                  onDragStart={() => setCarrying(r.id)}
                  onDragEnd={(_event, info) => {
                    setCarrying(null);
                    dropped.current = Date.now();
                    // The card under the pointer is the card being carried,
                    // so the column is read off the columns themselves:
                    // they are strips, and the pointer's x says which.
                    const x = info.point.x;
                    const onto = [
                      ...document.querySelectorAll("[data-lane]"),
                    ].find((lane) => {
                      const box = lane.getBoundingClientRect();
                      return x >= box.left && x <= box.right;
                    });
                    if (!onto) return;
                    void move(r.id, onto.getAttribute("data-lane") || null);
                  }}
                  className={cx(
                    "flex cursor-grab flex-col gap-1 rounded-xl border border-border-button-default bg-background-primary-default p-3 active:cursor-grabbing",
                    carrying === r.id && "z-10 shadow-dropdown",
                  )}
                >
                  <a
                    href={recordPageHref(r.id, here)}
                    draggable={false}
                    onClick={(e) => {
                      if (Date.now() - dropped.current < 300)
                        e.preventDefault();
                    }}
                    className="line-clamp-2 text-body-medium text-text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                  >
                    {r.title || "(untitled)"}
                  </a>
                  {r.line && (
                    <span className="line-clamp-2 text-caption-1-regular text-text-secondary">
                      {r.line}
                    </span>
                  )}
                  <span className="text-caption-2-regular text-text-secondary">
                    {r.at && <LocalTime at={r.at} fallback="" />}
                  </span>
                </motion.div>
              ))}
              {lane.held > rows.length && (
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() =>
                    go((p) => {
                      p.set("view", "table");
                      p.append(
                        "f",
                        lane.value === null
                          ? `${group}:unset`
                          : `${group}:eq:${lane.value}`,
                      );
                    })
                  }
                >
                  See all {lane.held}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
