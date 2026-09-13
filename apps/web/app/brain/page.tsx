import {
  Invalid,
  opened,
  requestsOf,
  stubs,
  type BrainRecord,
} from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { groupsIn } from "@maslow/db/groups";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { EagerLink } from "@/components/eager-link";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { principal } from "@/lib/session";

import { Asks } from "./asks";
import { BAND, Days } from "./days";
import { vocabulary } from "./catalog";
import { cell, recordHref } from "./format";
import { NewRecord } from "./new-record";
import { TypeMark } from "./type-icon";

// What the list shows: everything, or one type, whose when the type is a
// colleague's, whose records, a search, and where the page starts.
type Params = {
  type?: string;
  from?: string;
  whose?: string;
  by?: string;
  q?: string;
  cursor?: string;
};

// Whose records the list holds: everyone's you can see, your own, or the
// ones colleagues shared with you.
const WHOSE = {
  all: "Everything",
  mine: "Yours",
  shared: "Shared with you",
} as const;
type Whose = keyof typeof WHOSE;
const isWhose = (v: string | undefined): v is Whose =>
  !!v && Object.hasOwn(WHOSE, v);

// How the list is cut into runs: by what a record is, or by the day it
// happened, falling back to the day it turned up.
const BY = { type: "By type", recent: "Recent" } as const;

// Where a field's column shows: the first two once the list has room for
// them beside the title, the rest only once it is wider still.
const column = (n: number) =>
  n < 2
    ? "hidden w-24 shrink-0 @[34rem]:block"
    : "hidden w-24 shrink-0 @[48rem]:block";

// The first line of a record, as much of it as a row can hold: a body is a
// whole document and only its opening is read here.
const line = (body: string) => body.trim().split("\n", 1)[0]!.slice(0, 200);

type By = keyof typeof BY;
const isBy = (v: string | undefined): v is By => !!v && Object.hasOwn(BY, v);

// Everything this brain knows; or one type, with its fields as columns.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  // A parameter given twice counts once.
  const params = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v,
    ]),
  ) as Params;
  const { types, people } = await vocabulary(p);
  const mine = types.filter((t) => t.own);
  const type = types.find(
    (t) =>
      t.name === params.type &&
      (params.from ? t.ownerId === params.from : t.own),
  );
  if (params.type && !type) redirect("/brain");
  // A row shows the first few of a type's fields; the record itself holds
  // them all, and a narrow window has no room for a long line of columns.
  const properties = (type?.properties ?? []).slice(0, 4);
  const only: Whose = isWhose(params.whose) ? params.whose : "all";
  const by: By = isBy(params.by) ? params.by : "type";

  // The same view with one parameter changed.
  const href = (changes: Partial<Params>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...changes })) {
      if (v && k !== "cursor") next.set(k, v);
    }
    if (changes.cursor) next.set("cursor", changes.cursor);
    const s = next.toString();
    return `/brain${s ? `?${s}` : ""}`;
  };

  let page, asks, asked, groups;
  try {
    ({ page, asks, asked, groups } = await asPerson(p, async (db) => {
      const asks = await requestsOf(db);
      return {
        page: await opened(db, {
          type: type?.name,
          owner: type?.ownerId,
          scope: only,
          query: params.q || undefined,
          cursor: params.cursor,
        }),
        asks,
        asked: await stubs(
          db,
          asks.flatMap((a) =>
            a.items.flatMap((it) => ("record" in it ? [it.record] : [])),
          ),
        ),
        groups: asks.length ? await groupsIn(db) : [],
      };
    }));
  } catch (err) {
    // A cursor from another query, or none at all: the first page.
    if (err instanceof Invalid && params.cursor) redirect(href({}));
    throw err;
  }
  const whose = (r: BrainRecord) =>
    r.ownerId === p.userId ? null : (people.get(r.ownerId) ?? "someone");
  // Whose it is, as two letters, since at any size the name is the same
  // handful of words on every row.
  const initials = (name: string) =>
    name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
  const at = (r: (typeof page.records)[number]) => r.occurredAt ?? r.createdAt;
  const row = (r: (typeof page.records)[number]) => (
    <EagerLink
      href={recordHref(r.id)}
      className="hover:bg-muted/45 flex items-baseline gap-4 border-t px-3.5 py-2.5"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium">
            {r.title || "(untitled)"}
          </span>
          {whose(r) && (
            <span className="text-muted-foreground bg-muted shrink-0 rounded-full px-1.5 text-[10px] leading-[15px] font-medium">
              {initials(whose(r)!)}
            </span>
          )}
        </span>
        {r.body.trim() && (
          <span className="text-muted-foreground truncate text-xs">
            {line(r.body)}
          </span>
        )}
      </span>
      {type &&
        properties.map((f, n) => (
          <span key={f.id} className={`${column(n)} truncate text-xs`}>
            {cell(r.props[f.name], f)}
          </span>
        ))}
      <span className="text-muted-foreground hidden w-32 shrink-0 text-right text-xs whitespace-nowrap tabular-nums @[26rem]:block">
        {r.occurredAt && <LocalTime at={r.occurredAt} fallback="" />}
      </span>
    </EagerLink>
  );
  // By type the rows do not arrive together, so each type gathers its own
  // and the fullest-recent type leads. By day the browser cuts them, since
  // which day a record falls on is the reader's own zone to say.
  const bands: { key: string; head: ReactNode; rows: typeof page.records }[] =
    [];
  if (by === "type") {
    for (const r of page.records) {
      const key = `${r.ownerId}:${r.type}`;
      const band = bands.find((b) => b.key === key);
      if (band) band.rows.push(r);
      else
        bands.push({
          key,
          head: (
            <TypeMark
              type={r.type}
              owner={r.ownerId === p.userId ? undefined : r.ownerId}
            />
          ),
          rows: [r],
        });
    }
  }

  // Whether to offer the two ways of cutting the list: one type on its own
  // is already one run. And whose, only where a colleague has shared in.
  const offerBy = !type;
  const offerWhose = !type && types.some((t) => !t.own);
  return (
    <Card className="@container gap-0 overflow-visible rounded-[14px] py-0">
      <div className="bg-card sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-t-[14px] p-3.5">
        <form method="get" className="min-w-56 flex-1">
          {type && <input type="hidden" name="type" value={type.name} />}
          {type && !type.own && (
            <input type="hidden" name="from" value={type.ownerId} />
          )}
          {only !== "all" && <input type="hidden" name="whose" value={only} />}
          {by !== "type" && <input type="hidden" name="by" value={by} />}
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder={type ? `Search ${type.name}s` : "Search"}
              className="bg-background rounded-full pl-8"
            />
          </div>
        </form>
        {offerBy && (
          <div className="bg-muted flex shrink-0 items-center gap-0.5 rounded-full p-0.5">
            {(Object.keys(BY) as By[]).map((k) => (
              <Button
                key={k}
                variant={k === by ? "secondary" : "ghost"}
                size="sm"
                className="h-7 rounded-full px-3 text-xs font-normal aria-[current]:font-medium"
                nativeButton={false}
                render={
                  <EagerLink
                    href={href({ by: k === "type" ? undefined : k })}
                    aria-current={k === by ? "page" : undefined}
                  />
                }
              >
                {BY[k]}
              </Button>
            ))}
          </div>
        )}
        {offerWhose && (
          <div className="bg-muted flex shrink-0 items-center gap-0.5 rounded-full p-0.5">
            {(Object.keys(WHOSE) as Whose[]).map((k) => (
              <Button
                key={k}
                variant={k === only ? "secondary" : "ghost"}
                size="sm"
                className="h-7 rounded-full px-3 text-xs font-normal aria-[current]:font-medium"
                nativeButton={false}
                render={
                  <EagerLink
                    href={href({ whose: k === "all" ? undefined : k })}
                    aria-current={k === only ? "page" : undefined}
                  />
                }
              >
                {WHOSE[k]}
              </Button>
            ))}
          </div>
        )}
        {(!type || type.own) && <NewRecord types={mine} type={type} />}
      </div>
      <Asks
        asks={asks}
        records={new Map(asked.map((r) => [r.id, r]))}
        types={types}
        people={people}
        groups={groups}
      />
      {type && !type.own && (
        <p className="text-muted-foreground px-3.5 pb-3 text-sm">
          {people.get(type.ownerId) ?? "someone"}&apos;s {type.name}s, shared
          with you.
        </p>
      )}
      {page.records.length === 0 ? (
        <p className="text-muted-foreground px-3.5 pb-4 text-sm">
          {params.q
            ? "Nothing matches."
            : type
              ? `No ${type.name}s yet.`
              : "This brain is empty. Write a note, or let your agent start."}
        </p>
      ) : (
        <div className="flex flex-col">
          {by === "recent" && (
            <Days
              rows={page.records.map((r) => ({
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
                {properties.length > 0 && (
                  <>
                    <span className="min-w-0 flex-1" />
                    {properties.map((f, n) => (
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
      )}
      {page.cursor && (
        <div className="px-3.5 pt-1 pb-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground rounded-full"
            nativeButton={false}
            render={<Link href={href({ cursor: page.cursor })} />}
          >
            More
          </Button>
        </div>
      )}
    </Card>
  );
}
