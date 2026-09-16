import type { BrainRecord, Property } from "@maslow/brain";
import type { ReactNode } from "react";

import { Avatar } from "@/components/base/avatar/avatar";
import { EagerLink } from "@/components/eager-link";
import { LocalTime } from "@/components/local-time";
import { cx } from "@/utils/cx";

import { BAND, Days } from "../days";
import { cell, opening, recordHref } from "../format";
import { TypeIcon, TypeMark } from "../type-icon";

// Where a field's column shows: the first two once the list has room for
// them beside the title, the rest only once it is wider still.
const column = (n: number) =>
  n < 2
    ? "hidden w-24 shrink-0 @[34rem]:block"
    : "hidden w-24 shrink-0 @[48rem]:block";

// Whose a record is, as two letters, since at any size the name is the same
// handful of words on every row.
const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

// The records as rows of a title and the first line of what they say, cut
// either into their types or into the days they happened, and marked with
// whose they are where they are not the reader's.
export function ListView({
  records,
  properties,
  by,
  me,
  people,
  showFields,
}: {
  records: BrainRecord[];
  properties: Property[];
  // Whether the runs are the types or the days.
  by: "type" | "recent";
  me: string;
  people: Map<string, string>;
  // A list of one type shows that type's first few fields beside the title.
  showFields: boolean;
}) {
  const whose = (r: BrainRecord) =>
    r.ownerId === me ? null : (people.get(r.ownerId) ?? "someone");
  const at = (r: BrainRecord) => r.occurredAt ?? r.createdAt;
  const shown = showFields ? properties.slice(0, 4) : [];
  const row = (r: BrainRecord) => (
    <EagerLink
      href={recordHref(r.id)}
      className="flex min-h-11 items-baseline gap-4 border-t border-separator-border px-3 py-2.5 outline-none transition-colors duration-fast ease-plain hover:bg-background-primary-hover active:bg-background-primary-active focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-inset"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          {by === "recent" && (
            <TypeIcon type={r.type} className="self-center" />
          )}
          <span className="truncate text-body-medium text-text-primary">
            {r.title || "(untitled)"}
          </span>
          {whose(r) && (
            <Avatar
              size="xs"
              initials={initials(whose(r)!)}
              title={whose(r)!}
            />
          )}
        </span>
        {r.body.trim() && (
          <span className="truncate text-caption-1-regular text-text-secondary">
            {opening(r.body)}
          </span>
        )}
      </span>
      {shown.map((f, n) => (
        <span
          key={f.id}
          className={`${column(n)} truncate text-body-2-regular text-text-secondary`}
        >
          {cell(r.props[f.name], f)}
        </span>
      ))}
      <span
        className={cx(
          "hidden shrink-0 text-right text-caption-1-regular whitespace-nowrap text-text-secondary tabular-nums @[26rem]:block",
          // Under a day band the day is already said; only the time is news.
          by === "recent" ? "w-12" : "w-32",
        )}
      >
        {r.occurredAt && (
          <LocalTime
            at={r.occurredAt}
            fallback=""
            clockOnly={by === "recent"}
          />
        )}
      </span>
    </EagerLink>
  );

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
              className="text-text-secondary"
            />
          ),
          rows: [r],
        });
    }
  }

  return (
    <div className="flex flex-col">
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
          <div className={BAND}>
            {band.head}
            {shown.length > 0 && (
              <>
                <span className="min-w-0 flex-1" />
                {shown.map((f, n) => (
                  <span key={f.id} className={`${column(n)} truncate`}>
                    {f.name}
                  </span>
                ))}
                <span className="hidden w-32 shrink-0 @[26rem]:block" />
              </>
            )}
          </div>
          {band.rows.map((r) => (
            <div key={r.id} className="contents">
              {row(r)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
