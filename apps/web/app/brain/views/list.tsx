import type { BrainRecord } from "@maslow/brain";
import type { ReactNode } from "react";

import { Avatar } from "@/components/base/avatar/avatar";
import { EagerLink } from "@/components/eager-link";
import { LocalTime } from "@/components/local-time";
import { cx } from "@/utils/cx";

import { BAND, Days } from "../days";
import { opening, typeText } from "../format";
import { TypeIcon, TypeMark } from "../type-icon";
import { Walk } from "./walk";

// Whose a record is, as two letters, since at any size the name is the same
// handful of words on every row.
const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

// The records as rows of a title and the first line of what they say, cut
// either into their types or into the days they were last changed, and marked with
// whose they are where they are not the reader's. The one open reads
// beside the list, the arrow keys walk to the next, and a double-click
// opens a record as a whole page.
export function ListView({
  records,
  by,
  me,
  people,
  open,
  hrefOf,
  fullOf,
}: {
  records: BrainRecord[];
  // Whether the runs are the types or the days.
  by: "type" | "recent";
  me: string;
  people: Map<string, string>;
  // The record open beside the list.
  open?: string;
  // Where a row goes: the same list with that record open.
  hrefOf: (id: string) => string;
  // Where a double-click on a row goes: the record as a whole page.
  fullOf: (id: string) => string;
}) {
  const whose = (r: BrainRecord) =>
    r.ownerId === me ? null : (people.get(r.ownerId) ?? "someone");
  const at = (r: BrainRecord) => r.updatedAt;
  const row = (r: BrainRecord) => {
    const lit = r.id === open;
    return (
      <EagerLink
        key={r.id}
        href={hrefOf(r.id)}
        data-full={fullOf(r.id)}
        aria-current={lit ? "true" : undefined}
        className={cx(
          "relative mx-2 flex flex-col gap-0.5 rounded-xl px-3 py-2 outline-none transition-colors duration-fast ease-plain focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-inset",
          // The hairline between two rows, drawn under each but the first
          // and hidden where the open row's fill covers it.
          "before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-separator-border first:before:hidden",
          lit
            ? "bg-background-secondary-hover before:hidden [&+a]:before:hidden"
            : "hover:bg-background-primary-hover active:bg-background-primary-active",
        )}
      >
        <span className="flex items-center gap-2">
          {by === "recent" && (
            <TypeIcon type={r.type} className="size-2.5 rounded-[3px]" />
          )}
          <span className="truncate text-body-medium text-text-primary">
            {r.title || "(untitled)"}
          </span>
          {whose(r) && (
            <Avatar
              size="xs"
              initials={initials(whose(r)!)}
              title={whose(r)!}
              className="ml-auto shrink-0"
            />
          )}
        </span>
        <span className="flex items-baseline gap-2 text-caption-1-regular">
          <span className="shrink-0 text-text-secondary tabular-nums">
            {/* Under a day band the day is already said; only the time is
                news. */}
            <LocalTime
              at={r.updatedAt}
              fallback=""
              clockOnly={by === "recent"}
            />
          </span>
          <span className="truncate text-text-tertiary">
            {r.body.trim() ? opening(r.body) : typeText(r.type)}
          </span>
        </span>
      </EagerLink>
    );
  };

  // By type the rows do not arrive together, so each type gathers its own
  // and the fullest-recent type leads. By day the browser cuts them, since
  // which day a record falls on is the reader's own zone to say.
  const bands: { key: string; head: ReactNode; rows: BrainRecord[] }[] = [];
  if (by === "type") {
    for (const r of records) {
      const key = `${r.ownerId}:${r.type}`;
      const band = bands.find((b) => b.key === key);
      if (band) band.rows.push(r);
      else
        bands.push({
          key,
          head: (
            <TypeMark
              type={r.type}
              owner={r.ownerId === me ? undefined : r.ownerId}
              className="text-text-tertiary"
            />
          ),
          rows: [r],
        });
    }
  }
  const order = by === "type" ? bands.flatMap((b) => b.rows) : records;

  return (
    <div className="flex flex-col pb-2">
      <Walk
        hrefs={order.map((r) => hrefOf(r.id))}
        at={order.findIndex((r) => r.id === open)}
      />
      {by === "recent" && (
        <Days
          rows={records.map((r) => ({
            id: r.id,
            at: new Date(at(r)).toISOString(),
            row: row(r),
          }))}
        />
      )}
      {bands.map((band) => (
        <div key={band.key} className="flex flex-col">
          <div className={BAND}>{band.head}</div>
          {band.rows.map(row)}
        </div>
      ))}
    </div>
  );
}
