import {
  catalog,
  graph,
  Invalid,
  read,
  type BrainRecord,
  type BrainType,
  type Filter,
  type Property,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { DateField } from "@/components/date-field";
import { FormDialog } from "@/components/form-dialog";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { principal } from "@/lib/session";

import { DatatypeBadge } from "./datatype-badge";
import { FieldInputs } from "./fields";
import { cell, recordHref } from "./format";
import { BrainGraph } from "./graph/lazy";
import { Split } from "./graph/split";
import { peopleOf } from "./people";
import { TypeIcon, TypeMark } from "./type-icon";

// The query the table shows: a type or all, whose when the type is shared
// into this brain, a search, one value per enum field, a sort column and
// direction, and where the page starts.
type Params = {
  scope?: "mine" | "shared" | "all";
  type?: string;
  from?: string;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  cursor?: string;
  deleted?: string;
  [filter: `f.${string}`]: string | undefined;
};

const sortable = (p: Property) => p.datatype !== "list";

// The signed-in person's records as a table beside the graph of everything.
// Picking a type adds its declared fields as columns, sortable and
// filterable, and leaves the graph to the whole view.
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
  const { types, people } = await asPerson(p, async (db) => ({
    ...(await catalog(db)),
    people: await peopleOf(db),
  }));
  const mine = types.filter((t) => t.own);
  const type = types.find(
    (t) =>
      t.name === params.type &&
      (params.from ? t.ownerId === params.from : t.own),
  );
  if (params.type && !type) redirect("/brain");
  const properties = type?.properties ?? [];
  const enums = properties.filter((f) => f.datatype === "enum");

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

  const where: Filter[] = enums.flatMap((f) => {
    const v = params[`f.${f.name}`];
    return v && f.options?.includes(v)
      ? [{ property: f.name, op: "eq" as const, value: v }]
      : [];
  });
  const sortField = properties.find(
    (f) => f.name === params.sort && sortable(f),
  );
  const dir = params.dir === "asc" ? "asc" : "desc";
  const scope =
    params.scope === "shared" || params.scope === "all" ? params.scope : "mine";
  let page, whole;
  try {
    ({ page, whole } = await asPerson(p, async (db) => ({
      page: await read(db, {
        scope,
        type: type?.name,
        owner: type && !type.own ? type.ownerId : undefined,
        query: params.q || undefined,
        where,
        orderBy: sortField
          ? { property: sortField.name, direction: dir }
          : undefined,
        includeDeleted: params.deleted === "1",
        cursor: params.cursor,
      }),
      whole: type ? null : await graph(db),
    })));
  } catch (err) {
    // A cursor from another query, or none at all: the first page.
    if (err instanceof Invalid && params.cursor) redirect(href({}));
    throw err;
  }
  const sortLink = (name: string, label: string) => {
    const active = (params.sort ?? "when") === name;
    const nextDir = active && dir === "desc" ? "asc" : "desc";
    return (
      <a
        href={href({ sort: name === "when" ? undefined : name, dir: nextDir })}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ChevronUpIcon className="size-3" />
          ) : (
            <ChevronDownIcon className="size-3" />
          ))}
      </a>
    );
  };

  const view = (
    <>
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {type && <TypeIcon type={type.name} className="size-5" />}
          {type ? type.name : "Records"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {type && !type.own
            ? `${people.get(type.ownerId) ?? "Someone no longer here"}'s, shared with you.`
            : "Everything this brain knows, newest first."}
        </p>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2">
        {type && <input type="hidden" name="type" value={type.name} />}
        {type && !type.own && (
          <input type="hidden" name="from" value={type.ownerId} />
        )}
        {!type && (
          <Select name="scope" defaultValue={scope}>
            <SelectTrigger aria-label="Whose">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Mine</SelectItem>
              <SelectItem value="shared">Shared with me</SelectItem>
              <SelectItem value="all">Everything I can see</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="relative w-full sm:w-64">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder={type ? `Search ${type.name}s` : "Search"}
            className="pl-8"
          />
        </div>
        {!type && mine.length > 0 && (
          <Select name="type" defaultValue="">
            <SelectTrigger aria-label="Type">
              <SelectValue placeholder="Any type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Any type</SelectItem>
              {mine.map((t) => (
                <SelectItem key={t.id} value={t.name}>
                  <TypeIcon type={t.name} />
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {enums.map((f) => (
          <Select
            key={f.id}
            name={`f.${f.name}`}
            defaultValue={params[`f.${f.name}`] ?? ""}
          >
            <SelectTrigger aria-label={f.name}>
              <SelectValue placeholder={`Any ${f.name}`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Any {f.name}</SelectItem>
              {f.options?.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        <Label className="text-muted-foreground gap-1.5 font-normal">
          <Checkbox
            name="deleted"
            value="1"
            defaultChecked={params.deleted === "1"}
          />
          Show deleted
        </Label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        <span className="text-muted-foreground text-sm">
          {page.records.length}
          {page.cursor ? "+" : ""} {type ? type.name : "record"}
          {page.records.length === 1 ? "" : "s"}
        </span>
        <span className="flex-1" />
        {(!type || type.own) && (
          <NewRecord type={type ?? mine.find((t) => t.name === "note")} />
        )}
      </form>

      {page.records.length === 0 && types.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This brain is empty. Write a note, or define a type in{" "}
          <a href="/brain/vocabulary" className="underline">
            vocabulary
          </a>{" "}
          to start a table.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              {type ? (
                properties.map((f) => (
                  <TableHead key={f.id}>
                    <span className="inline-flex items-center gap-1.5">
                      {sortable(f) ? sortLink(f.name, f.name) : f.name}
                      <DatatypeBadge datatype={f.datatype} />
                    </span>
                  </TableHead>
                ))
              ) : (
                <TableHead>Type</TableHead>
              )}
              <TableHead className="hidden sm:table-cell">
                {sortLink("when", "When")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.records.map((r) => (
              <Row key={r.id} r={r} type={type} me={p.userId} />
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
          render={<a href={href({ cursor: page.cursor })} />}
        >
          Next page
        </Button>
      )}
    </>
  );
  if (!whole) return <div className="space-y-4">{view}</div>;
  return <Split graph={<BrainGraph graph={whole} />}>{view}</Split>;
}

// A record as a row. The whole row opens it; its type opens the type's
// table, which is its owner's.
function Row({
  r,
  type,
  me,
}: {
  r: BrainRecord;
  type?: BrainType;
  me: string;
}) {
  return (
    <TableRow
      className={`relative ${r.deletedAt ? "text-muted-foreground" : ""}`}
    >
      <TableCell className="max-w-xs whitespace-normal">
        <a
          href={recordHref(r.id)}
          className="font-medium after:absolute after:inset-0 hover:underline"
        >
          {r.title || "(untitled)"}
        </a>
        {r.deletedAt && (
          <Badge variant="outline" className="ml-2">
            {r.mergedInto ? "merged" : "deleted"}
          </Badge>
        )}
        {r.access !== "owner" && (
          <Badge variant="secondary" className="ml-2">
            shared, {r.access}
          </Badge>
        )}
      </TableCell>
      {type ? (
        type.properties.map((f) => (
          <TableCell key={f.id} className="max-w-48 truncate">
            {cell(r.props[f.name], f)}
          </TableCell>
        ))
      ) : (
        <TableCell>
          <TypeMark
            type={r.type}
            owner={r.ownerId === me ? undefined : r.ownerId}
            className="relative z-10"
          />
        </TableCell>
      )}
      <TableCell className="text-muted-foreground hidden whitespace-nowrap sm:table-cell">
        <LocalTime at={r.occurredAt} fallback="—" />
      </TableCell>
    </TableRow>
  );
}

// A row added by hand: a note when no type is chosen, otherwise a record of
// the type with its declared fields. A note has fields once someone has
// declared them.
function NewRecord({ type }: { type?: BrainType }) {
  const name = type?.name ?? "note";
  return (
    <FormDialog trigger={`New ${name}`} variant="default" title={`New ${name}`}>
      <form action="/brain/records" method="post" className="grid gap-3">
        <input type="hidden" name="type" value={name} />
        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required autoFocus />
        </div>
        <div className="space-y-1">
          <Label htmlFor="body">Body, markdown</Label>
          <Textarea id="body" name="body" rows={6} />
        </div>
        <FieldInputs properties={type?.properties ?? []} />
        <div className="space-y-1">
          <Label htmlFor="occurred_at">When</Label>
          <DateField id="occurred_at" name="occurred_at" time />
        </div>
        <div>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </FormDialog>
  );
}
