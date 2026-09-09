import { Invalid, list, requestsOf, stubs, type Stub } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { groupsIn } from "@maslow/db/groups";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EagerLink } from "@/components/eager-link";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { NewRecord } from "./new-record";
import { TypeMark } from "./type-icon";

// What the list shows: everything, or one type, whose when the type is a
// colleague's, a search, and where the page starts.
type Params = {
  type?: string;
  from?: string;
  q?: string;
  cursor?: string;
};

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
        page: await list(db, {
          type: type?.name,
          owner: type?.ownerId,
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
  const whose = (r: Stub) =>
    r.ownerId === p.userId ? null : (people.get(r.ownerId) ?? "someone");
  return (
    <Card className="gap-0 rounded-[14px] py-0">
      <div className="flex items-center gap-3 p-3.5">
        <form method="get" className="min-w-0 flex-1">
          {type && <input type="hidden" name="type" value={type.name} />}
          {type && !type.own && (
            <input type="hidden" name="from" value={type.ownerId} />
          )}
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
      {page.records.length === 0 && !params.q ? (
        <p className="text-muted-foreground px-3.5 pb-4 text-sm">
          {type
            ? `No ${type.name}s yet.`
            : "This brain is empty. Write a note, or let your agent start."}
        </p>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Title</TableHead>
              {type ? (
                properties.map((f) => (
                  <TableHead key={f.id}>{f.name}</TableHead>
                ))
              ) : (
                <TableHead className="w-44">Type</TableHead>
              )}
              <TableHead className="hidden w-40 text-right sm:table-cell">
                When
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.records.map((r) => (
              <TableRow key={r.id} className="relative h-10">
                <TableCell className="max-w-xs whitespace-normal">
                  <EagerLink
                    href={recordHref(r.id)}
                    className="font-medium after:absolute after:inset-0"
                  >
                    {r.title || "(untitled)"}
                  </EagerLink>
                  {whose(r) && (
                    <span className="text-muted-foreground ml-2 text-[11.5px]">
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
                <TableCell className="text-muted-foreground hidden text-right text-xs whitespace-nowrap tabular-nums sm:table-cell">
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
