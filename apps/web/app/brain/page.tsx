import {
  get,
  Invalid,
  read,
  requestsOf,
  type BrainRecord,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { groupsIn } from "@placeholder/db/groups";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EagerLink } from "@/components/eager-link";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { principal } from "@/lib/session";

import { Asks } from "./asks";
import { vocabulary } from "./catalog";
import { cell, recordHref } from "./format";
import { Split } from "./graph/split";
import { NewRecord } from "./new-record";
import { WholeGraph } from "./graph/whole";
import { TypeIcon, TypeMark } from "./type-icon";

// What the list shows: everything, or one type, whose when the type is a
// colleague's, a search, and where the page starts.
type Params = {
  type?: string;
  from?: string;
  q?: string;
  cursor?: string;
};

// Everything this brain knows, beside the graph of it; or one type, with
// its fields as columns.
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
  const properties = type?.properties ?? [];

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
        page: await read(db, {
          type: type?.name,
          owner: type?.ownerId,
          query: params.q || undefined,
          cursor: params.cursor,
        }),
        asks,
        asked: await get(
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

  const view = (
    <>
      <Asks
        asks={asks}
        records={new Map(asked.map((r) => [r.id, r]))}
        types={types}
        people={people}
        groups={groups}
      />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {type && <TypeIcon type={type.name} className="size-5" />}
          {type ? type.name : "Brain"}
        </h1>
        {type && !type.own && (
          <span className="text-muted-foreground text-sm">
            {people.get(type.ownerId) ?? "someone"}&apos;s, shared with you
          </span>
        )}
        <span className="flex-1" />
        {(!type || type.own) && <NewRecord types={mine} type={type} />}
      </div>
      <form method="get" className="flex items-center gap-2">
        {type && <input type="hidden" name="type" value={type.name} />}
        {type && !type.own && (
          <input type="hidden" name="from" value={type.ownerId} />
        )}
        <div className="relative w-full sm:w-72">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder={type ? `Search ${type.name}s` : "Search"}
            className="pl-8"
          />
        </div>
      </form>

      {page.records.length === 0 && !params.q ? (
        <p className="text-muted-foreground text-sm">
          {type
            ? `No ${type.name}s yet.`
            : "This brain is empty. Write a note, or let your agent start."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              {type ? (
                properties.map((f) => (
                  <TableHead key={f.id}>{f.name}</TableHead>
                ))
              ) : (
                <TableHead>Type</TableHead>
              )}
              <TableHead className="hidden sm:table-cell">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.records.map((r) => (
              <TableRow key={r.id} className="relative">
                <TableCell className="max-w-xs whitespace-normal">
                  <EagerLink
                    href={recordHref(r.id)}
                    className="font-medium after:absolute after:inset-0 hover:underline"
                  >
                    {r.title || "(untitled)"}
                  </EagerLink>
                  {whose(r) && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {whose(r)}&apos;s
                    </span>
                  )}
                </TableCell>
                {type ? (
                  properties.map((f) => (
                    <TableCell key={f.id} className="max-w-48 truncate">
                      {cell(r.props[f.name], f)}
                    </TableCell>
                  ))
                ) : (
                  <TableCell>
                    <TypeMark
                      type={r.type}
                      owner={r.ownerId === p.userId ? undefined : r.ownerId}
                      className="relative z-10"
                    />
                  </TableCell>
                )}
                <TableCell className="text-muted-foreground hidden whitespace-nowrap sm:table-cell">
                  <LocalTime at={r.occurredAt} fallback="—" />
                </TableCell>
              </TableRow>
            ))}
            {page.records.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={2 + (type ? properties.length : 1)}
                  className="text-muted-foreground"
                >
                  Nothing matches.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      {page.cursor && (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={href({ cursor: page.cursor })} />}
        >
          More
        </Button>
      )}
    </>
  );
  if (type) return <div className="space-y-4">{view}</div>;
  return <Split graph={<WholeGraph />}>{view}</Split>;
}
