import {
  Invalid,
  list,
  opened,
  requestsOf,
  stubs,
  tally,
  type BrainRecord,
  type Property,
  type ReadOptions,
  type Stub,
} from "@maslow/brain";
import { asPerson, isUuid } from "@maslow/db";
import { viewOf } from "@maslow/db/brain-views";
import { groupsIn } from "@maslow/db/groups";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { userAgent } from "next/server";

import { principal } from "@/lib/session";

import { Asks } from "./asks";
import { Cut, Ways } from "./cut";
import { vocabulary } from "./catalog";
import { opening } from "./format";
import { LinkButton } from "./link-button";
import { NewRecord } from "./new-record";
import { Search } from "./search";
import { BoardView, type Lane } from "./views/board";
import { CalendarView } from "./views/calendar";
import { Filters } from "./views/filters";
import { KEPT, subjectOf } from "./views/kept";
import { ListView } from "./views/list";
import { monthOf, monthWindow, dayValue } from "./views/month";
import {
  isView,
  narrowFrom,
  termsFrom,
  VIEWS,
  WHEN,
  type Row,
  type View,
} from "./views/query";
import { Remember } from "./views/remember";
import { columnsFor } from "./views/columns";
import { TableView } from "./views/table";

// How the list is cut into runs: by what a record is, or by the day it
// happened, falling back to the day it turned up. The List view's own, as
// the other views cut themselves.
const BY = { type: "By type", recent: "Recent" } as const;
type By = keyof typeof BY;
const isBy = (v: string | undefined): v is By => !!v && Object.hasOwn(BY, v);

// How many cards one board column holds before it says how many more there
// are, and how many records a month of the calendar draws.
const IN_A_LANE = 20;
const IN_A_MONTH = 200;

// The narrower of two edges of a window of time, either of which may be
// open: the calendar's month and the conditions the person set both hold.
const later = (a?: Date, b?: Date) => (!a ? b : !b ? a : a > b ? a : b);
const earlier = (a?: Date, b?: Date) => (!a ? b : !b ? a : a < b ? a : b);

// Everything this brain knows, or one type, looked at as a list, a table, a
// board or a calendar, narrowed and sorted by the read door.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const raw = await searchParams;
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const many = (k: string) => {
    const v = raw[k];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  };

  const { types, people } = await vocabulary(p);
  const mine = types.filter((t) => t.own);
  const from = one("from");
  const type = types.find(
    (t) => t.name === one("type") && (from ? t.ownerId === from : t.own),
  );
  if (one("type") && !type) redirect("/brain");
  const properties: Property[] = type?.properties ?? [];

  // An address that says nothing about how to look opens where the person
  // left this list; one that says anything is what they asked for.
  const subject = subjectOf(type?.name, type?.ownerId);
  if (!KEPT.some((k) => raw[k] !== undefined)) {
    const saved = await asPerson(p, (db) => viewOf(db, subject));
    if (saved) {
      const to = new URLSearchParams();
      if (type) to.set("type", type.name);
      if (type && !type.own) to.set("from", type.ownerId);
      if (one("q")) to.set("q", one("q")!);
      redirect(`/brain?${to}${to.size ? "&" : ""}${saved}`);
    }
  }

  const by: By = isBy(one("by")) ? (one("by") as By) : "type";
  const terms = termsFrom(many("f"));
  const narrowed = narrowFrom(terms, properties);
  const sort = one("sort");
  const direction = one("dir") === "asc" ? "asc" : "desc";
  const whose = one("whose") ?? "all";
  const month = monthOf(one("month"));
  // The board's columns are one choice field; the calendar lies on when, or
  // on a date field of the type's.
  const choices = properties.filter((f) => f.datatype === "enum");
  const dated = properties.filter(
    (f) => f.datatype === "date" || f.datatype === "datetime",
  );
  const group =
    choices.find((f) => f.name === one("group"))?.name ?? choices[0]?.name;
  const on = dated.find((f) => f.name === one("on"))?.name ?? WHEN;
  // Which ways of looking this list offers: a board needs a choice field to
  // make its columns, and a board and a calendar are both of one type, since
  // everything at once has no field in common to lay itself out by.
  // A phone is too narrow for a column per field: whatever the address
  // says or the person kept, it opens the list, and the kept view stands
  // for the next wide screen.
  const phone =
    userAgent({ headers: await headers() }).device.type === "mobile";
  const ways = (Object.keys(VIEWS) as View[]).filter(
    (k) =>
      (k !== "board" || !!group) &&
      (k !== "table" || !phone) &&
      (k === "list" || k === "table" || !!type),
  );
  const wanted = isView(one("view")) ? (one("view") as View) : "list";
  const view: View = ways.includes(wanted) ? wanted : "list";

  // The same view with one thing changed.
  const href = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) {
      if (k === "cursor" || k in changes) continue;
      for (const had of Array.isArray(v) ? v : v ? [v] : [])
        next.append(k, had);
    }
    for (const [k, v] of Object.entries(changes)) if (v) next.set(k, v);
    const s = next.toString();
    return `/brain${s ? `?${s}` : ""}`;
  };

  const span =
    view === "calendar" && on === WHEN ? monthWindow(month) : undefined;
  const base: ReadOptions = {
    type: type?.name,
    owner: type ? type.ownerId : isUuid(whose) ? whose : undefined,
    scope: whose === "mine" || whose === "shared" ? whose : "all",
    query: one("q"),
    where: narrowed.where,
    since: later(span?.[0], narrowed.since),
    until: earlier(span?.[1], narrowed.until),
    orderBy: {
      property: properties.some((f) => f.name === sort) ? sort : undefined,
      direction,
    },
  };
  // A calendar laid on a date field asks the door for that month of it.
  if (view === "calendar" && on !== WHEN) {
    const [first, last] = monthWindow(month);
    base.where = [
      ...(base.where ?? []),
      { property: on, op: "gte", value: dayValue(first) },
      { property: on, op: "lt", value: dayValue(last) },
    ];
  }

  // A board's column as the door answers it, before its records become
  // the rows a card is drawn from.
  type Held = Omit<Lane, "rows"> & { rows: (BrainRecord | Stub)[] };
  let records: (BrainRecord | Stub)[] = [];
  let cursor: string | null = null;
  let lanes: Held[] = [];
  let asks, asked, groups;
  try {
    ({ records, cursor, lanes, asks, asked, groups } = await asPerson(
      p,
      async (db) => {
        const asks = await requestsOf(db);
        const groups = await groupsIn(db);
        let records: (BrainRecord | Stub)[] = [];
        let cursor: string | null = null;
        let lanes: Held[] = [];
        if (view === "board" && group) {
          const held = await tally(db, group, base);
          const values = [
            ...(properties.find((f) => f.name === group)?.options ?? []),
          ];
          for (const value of [...values, null]) {
            const page = await opened(db, {
              ...base,
              where: [
                ...(base.where ?? []),
                value === null
                  ? { property: group, op: "unset" }
                  : { property: group, op: "eq", value },
              ],
              limit: IN_A_LANE,
            });
            lanes.push({
              value,
              label: value ?? "No value",
              held: held.get(value) ?? 0,
              rows: page.records,
            });
          }
        } else if (view === "calendar") {
          records = (await list(db, { ...base, limit: IN_A_MONTH })).records;
        } else if (view === "table") {
          const page = await list(db, { ...base, cursor: one("cursor") });
          records = page.records;
          cursor = page.cursor;
        } else {
          const page = await opened(db, { ...base, cursor: one("cursor") });
          records = page.records;
          cursor = page.cursor;
        }
        return {
          records,
          cursor,
          lanes,
          asks,
          asked: await stubs(
            db,
            asks.flatMap((a) =>
              a.items.flatMap((it) => ("record" in it ? [it.record] : [])),
            ),
          ),
          groups,
        };
      },
    ));
  } catch (err) {
    // A cursor from another query, or none at all: the first page.
    if (err instanceof Invalid && one("cursor")) redirect(href({}));
    throw err;
  }

  // A record as every view but the list draws it: no body, only its first
  // line, and whose it is where it is not the reader's.
  const rowOf = (r: BrainRecord | Stub): Row => ({
    id: r.id,
    type: r.type,
    title: r.title,
    line: r.body ? opening(r.body) : "",
    at: r.createdAt.toISOString(),
    owner: r.ownerId === p.userId ? null : (people.get(r.ownerId) ?? "someone"),
    props: r.props,
  });
  const members = [...people].map(([id, name]) => ({ id, name }));
  // The ways of looking at this list, and the ways of cutting it: the
  // same options whether they are a row of segments or rows in a sheet.
  const viewCuts = ways.map((k) => ({
    key: k,
    label: VIEWS[k],
    // List is written out like any other, since an address that says
    // nothing about how to look opens the view the person kept.
    href: href({ view: k, cursor: undefined }),
  }));
  const listCuts = (Object.keys(BY) as By[]).map((k) => ({
    key: k,
    label: BY[k],
    href: href({ by: k === "type" ? undefined : k }),
  }));
  const nothing =
    view === "board" && group
      ? lanes.every((l) => l.held === 0)
      : records.length === 0;
  const mineAlone = !type || type.own;

  return (
    <div className="page-sheet @container overflow-visible rounded-3xl border border-border-button-default bg-background-primary-default">
      <Remember subject={subject} />
      {/* One row on a phone: what to search for, one button for how the
          list is narrowed, one for a new record, one for how it is looked
          at. On a wide screen the same controls lie along the bar with
          the conditions on a line under them. */}
      <div className="sticky top-0 z-20 flex items-center gap-3 rounded-t-3xl bg-background-primary-default p-3 max-sm:flex-nowrap sm:flex-wrap">
        <form
          method="get"
          className="min-w-56 flex-1 max-sm:order-1 max-sm:min-w-0"
        >
          {type && <input type="hidden" name="type" value={type.name} />}
          {type && !type.own && (
            <input type="hidden" name="from" value={type.ownerId} />
          )}
          {KEPT.flatMap((k) =>
            many(k).map((v, n) => (
              <input key={`${k}${n}`} type="hidden" name={k} value={v} />
            )),
          )}
          <Search
            name="q"
            defaultValue={one("q") ?? ""}
            placeholder={type ? `Search ${type.name}s` : "Search"}
          />
        </form>
        <Cut
          label="How to look at it"
          className="max-sm:hidden"
          current={view}
          options={viewCuts}
        />
        {view === "list" && !type && (
          <Cut
            label="Cut the list"
            className="max-sm:hidden"
            current={by}
            options={listCuts}
          />
        )}
        {mineAlone && (
          <div className="shrink-0 max-sm:order-3">
            <NewRecord types={mine} type={type} />
          </div>
        )}
        <Ways
          cuts={[
            { label: "How to look at it", current: view, options: viewCuts },
            ...(view === "list" && !type
              ? [{ label: "Cut the list", current: by, options: listCuts }]
              : []),
          ]}
        />
        <Filters
          properties={properties}
          people={members}
          offerWhose={!type && types.some((t) => !t.own)}
          sortsItself={view === "table"}
        />
      </div>
      {/* A search is a question about the records; what waits on the person
          is not an answer to it, and waits until the question is done. */}
      {!one("q") && (
        <Asks
          asks={asks}
          records={new Map(asked.map((r) => [r.id, r]))}
          types={types}
          people={people}
          groups={groups}
        />
      )}
      {type && !type.own && (
        <p className="px-3 pb-3 text-body-regular text-text-secondary">
          {people.get(type.ownerId) ?? "someone"}&apos;s {type.name}s, shared
          with you.
        </p>
      )}
      {nothing ? (
        <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
          <p className="text-body-regular text-text-secondary">
            {one("q")
              ? `Nothing matches “${one("q")}”.`
              : terms.length
                ? "Nothing is left once those conditions are met."
                : type
                  ? `No ${type.name}s yet.`
                  : "This brain is empty. Write a note, or let your agent start."}
          </p>
          {(one("q") || terms.length > 0) && (
            <LinkButton
              href={href({ q: undefined, f: undefined, cursor: undefined })}
            >
              {one("q") ? "Clear the search" : "Clear the conditions"}
            </LinkButton>
          )}
        </div>
      ) : view === "table" ? (
        <TableView
          rows={records.map(rowOf)}
          columns={columnsFor(properties, !type)}
          properties={properties}
          people={members}
          groups={groups.filter((g) => !g.everyone)}
          canChoose={mineAlone}
          cursor={cursor}
        />
      ) : view === "board" && group ? (
        <BoardView
          lanes={lanes.map((l) => ({ ...l, rows: l.rows.map(rowOf) }))}
          group={group}
          choices={choices.map((f) => f.name)}
          properties={properties}
          canWrite={mineAlone}
        />
      ) : view === "calendar" ? (
        <CalendarView
          rows={records.map(rowOf)}
          on={on}
          fields={dated.map((f) => f.name)}
          capped={records.length >= IN_A_MONTH}
        />
      ) : (
        <ListView
          records={records as BrainRecord[]}
          properties={properties}
          by={type ? "type" : by}
          me={p.userId}
          people={people}
          showFields={!!type}
        />
      )}
      {/* The table view keeps its own footer, on the pagination block. */}
      {view !== "table" && cursor && !nothing && (
        <div className="border-t border-separator-border p-3">
          <LinkButton href={href({ cursor })}>More</LinkButton>
        </div>
      )}
    </div>
  );
}
