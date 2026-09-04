import {
  catalog,
  graph,
  Invalid,
  read,
  type BrainRecord,
  type Filter,
  type Kind,
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

import { FieldInputs } from "./fields";
import { cell, recordHref } from "./format";
import { BrainGraph } from "./graph/lazy";
import { Split } from "./graph/split";
import { KindIcon, KindMark } from "./kind-icon";
import { TypeBadge } from "./type-badge";

// The query the table shows: a kind or all, a search, one value per enum
// field, a sort column and direction, and where the page starts.
type Params = {
  scope?: "mine" | "shared" | "all";
  kind?: string;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  cursor?: string;
  deleted?: string;
  [filter: `f.${string}`]: string | undefined;
};

const sortable = (p: Property) => p.type !== "list";

// The signed-in person's records as a table beside the graph of everything.
// Picking a kind adds its declared fields as columns, sortable and
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
  const { kinds } = await asPerson(p, catalog);
  const kind = kinds.find((k) => k.name === params.kind);
  if (params.kind && !kind) redirect("/brain");
  const properties = kind?.properties ?? [];
  const enums = properties.filter((f) => f.type === "enum");

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
        kind: kind?.name,
        query: params.q || undefined,
        where,
        orderBy: sortField
          ? { property: sortField.name, direction: dir }
          : undefined,
        includeDeleted: params.deleted === "1",
        cursor: params.cursor,
      }),
      whole: kind ? null : await graph(db),
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
          {kind && <KindIcon kind={kind.name} className="size-5" />}
          {kind ? kind.name : "Records"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {kind?.description ?? "Everything this brain knows, newest first."}
        </p>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2">
        {kind && <input type="hidden" name="kind" value={kind.name} />}
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
        <div className="relative w-full sm:w-64">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder={kind ? `Search ${kind.name}s` : "Search"}
            className="pl-8"
          />
        </div>
        {!kind && kinds.length > 0 && (
          <Select name="kind" defaultValue="">
            <SelectTrigger aria-label="Kind">
              <SelectValue placeholder="Any kind" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Any kind</SelectItem>
              {kinds.map((k) => (
                <SelectItem key={k.id} value={k.name}>
                  <KindIcon kind={k.name} />
                  {k.name}
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
          {page.cursor ? "+" : ""} {kind ? kind.name : "record"}
          {page.records.length === 1 ? "" : "s"}
        </span>
        <span className="flex-1" />
        <NewRecord kind={kind ?? kinds.find((k) => k.name === "note")} />
      </form>

      {page.records.length === 0 && kinds.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This brain is empty. Write a note, or define a kind in{" "}
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
              {kind ? (
                properties.map((f) => (
                  <TableHead key={f.id} title={f.description}>
                    <span className="inline-flex items-center gap-1.5">
                      {sortable(f) ? sortLink(f.name, f.name) : f.name}
                      <TypeBadge type={f.type} />
                    </span>
                  </TableHead>
                ))
              ) : (
                <TableHead>Kind</TableHead>
              )}
              <TableHead className="hidden sm:table-cell">
                {sortLink("when", "When")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.records.map((r) => (
              <Row key={r.id} r={r} kind={kind} />
            ))}
            {page.records.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={2 + (kind ? properties.length : 1)}
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

// A record as a row. The whole row opens it.
function Row({ r, kind }: { r: BrainRecord; kind?: Kind }) {
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
      {kind ? (
        kind.properties.map((f) => (
          <TableCell key={f.id} className="max-w-48 truncate">
            {cell(r.props[f.name], f)}
          </TableCell>
        ))
      ) : (
        <TableCell>
          <KindMark kind={r.kind} className="relative z-10" />
        </TableCell>
      )}
      <TableCell className="text-muted-foreground hidden whitespace-nowrap sm:table-cell">
        <LocalTime at={r.occurredAt} fallback="—" />
      </TableCell>
    </TableRow>
  );
}

// A row added by hand: a note when no kind is chosen, otherwise a record of
// the kind with its declared fields. A note has fields once someone has
// declared them.
function NewRecord({ kind }: { kind?: Kind }) {
  const name = kind?.name ?? "note";
  return (
    <FormDialog
      trigger={`New ${name}`}
      variant="default"
      title={`New ${name}`}
      description={kind?.description}
    >
      <form action="/brain/records" method="post" className="grid gap-3">
        <input type="hidden" name="kind" value={name} />
        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required autoFocus />
        </div>
        <div className="space-y-1">
          <Label htmlFor="body">Body, markdown</Label>
          <Textarea id="body" name="body" rows={6} />
        </div>
        <FieldInputs properties={kind?.properties ?? []} />
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
