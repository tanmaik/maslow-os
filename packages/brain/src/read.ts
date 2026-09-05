import { Invalid } from "./errors.ts";
import { accepts, expected, propertiesOf, sqlType } from "./properties.ts";
import {
  edgeColumns,
  eventColumns,
  recordSelect,
  toEdge,
  toEvent,
  toRecord,
  type EdgeRow,
  type EventRow,
  type RecordRow,
} from "./rows.ts";
import type {
  BrainRecord,
  Edge,
  Event,
  Filter,
  Layer,
  Property,
  Query,
  Sort,
} from "./types.ts";

export type ReadOptions = {
  // Whose records, when no kind is named: the reader's own, what others
  // shared with them, or both.
  scope?: "mine" | "shared" | "all";
  // One person's kind: the reader's own, or with owner, one shared into
  // this brain by that member.
  kind?: string;
  owner?: string;
  layer?: Layer;
  source?: string;
  // A person record's id: only records linked to it by an edge.
  person?: string;
  since?: Date;
  until?: Date;
  // Plain words, quoted phrases and -exclusions, as a search box takes them.
  query?: string;
  // Conditions on the kind's declared fields; need a kind.
  where?: Filter[];
  // Order by a declared field instead of by time; needs a kind. Records
  // without the field are left out.
  orderBy?: Sort;
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string | null;
};

export type Page = { records: BrainRecord[]; cursor: string | null };

export type HistoryOptions = {
  // Only the changes to one record, edge, kind, verb or field.
  of?: string;
  // Only changes before this point in the log; the next page.
  before?: number;
  limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// A page ends at a sort key and an id, under one order; the next page
// starts after them, under the same order.
type Cursor = { key: string; id: string; order: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encode = (c: Cursor) =>
  Buffer.from(JSON.stringify(c)).toString("base64url");
function decode(s: string, order: string): Cursor {
  let c: Partial<Cursor> | null = null;
  try {
    c = JSON.parse(Buffer.from(s, "base64url").toString());
  } catch {
    // Not a cursor at all; refused below.
  }
  if (
    typeof c?.key !== "string" ||
    typeof c.id !== "string" ||
    !UUID.test(c.id)
  ) {
    throw new Invalid("that is not a cursor");
  }
  if (c.order !== order) throw new Invalid("that cursor is from another query");
  return c as Cursor;
}

// Whether a cursor's key can be cast to the column it is compared with.
const keyFits = (type: string, key: string) =>
  type === "timestamptz" || type === "date"
    ? !Number.isNaN(Date.parse(key))
    : type === "numeric"
      ? Number.isFinite(Number(key))
      : type === "boolean"
        ? key === "true" || key === "false"
        : true;

const OPERATORS: Record<Exclude<Filter["op"], "in" | "contains">, string> = {
  eq: "=",
  ne: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};
const DIRECTIONS = { asc: "asc", desc: "desc" } as const;

// Records, newest first by when they happened, filtered and searched. Every
// record carries its source and ref, so a caller can cite it.
export async function read(q: Query, opts: ReadOptions = {}): Promise<Page> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const scope = opts.scope ?? "mine";
  if (!["mine", "shared", "all"].includes(scope)) {
    throw new Invalid(`"${String(scope)}" is not a scope`);
  }
  if (opts.owner && !opts.kind) throw new Invalid("an owner needs a kind");
  const params: unknown[] = [
    opts.includeDeleted ?? false,
    opts.kind ?? null,
    opts.owner ?? null,
    opts.layer ?? null,
    opts.source ?? null,
    opts.person ?? null,
    opts.since ?? null,
    opts.until ?? null,
    opts.query?.trim() || null,
  ];
  const where = [
    "($1::boolean or deleted_at is null)",
    "($2::text is null or kind = $2)",
    "($3::uuid is null or person_id = $3)",
    "($4::text is null or layer = $4)",
    "($5::text is null or source = $5)",
    `($6::uuid is null or (
       r.id not in (select same_record($6))
       and exists (
         select 1 from edges e
         join records p
           on p.id = case when e.from_id = r.id then e.to_id else e.from_id end
         where (e.from_id = r.id or e.to_id = r.id)
           and p.id in (select same_record($6)))))`,
    "($7::timestamptz is null or coalesce(occurred_at, created_at) >= $7)",
    "($8::timestamptz is null or coalesce(occurred_at, created_at) < $8)",
    "($9::text is null or search @@ websearch_to_tsquery('english', $9))",
    opts.kind
      ? "person_id = coalesce($3, current_member())"
      : scope === "mine"
        ? "person_id = current_member()"
        : scope === "shared"
          ? "person_id <> current_member()"
          : "true",
  ];
  const param = (value: unknown) => `$${params.push(value)}`;

  // Declared fields are read out of props and compared as their type. The
  // field's name is one parameter, whichever way it is read.
  let form: Map<string, Property> | null = null;
  const field = async (name: string) => {
    if (!opts.kind) throw new Invalid(`filtering by "${name}" needs a kind`);
    form ??= await propertiesOf(q, opts.kind, opts.owner);
    const p = form.get(name);
    if (!p) throw new Invalid(`${opts.kind} has no field "${name}"`);
    const key = param(p.name);
    return { p, key, expr: `(props ->> ${key})::${sqlType[p.type]}` };
  };
  // A filter's value must be what the field says, so the database never
  // sees a cast it cannot make.
  const fits = (p: Property, v: unknown) => {
    if (!accepts(p, v)) {
      throw new Invalid(`${opts.kind}.${p.name} filter must be ${expected(p)}`);
    }
  };
  for (const f of opts.where ?? []) {
    const { p, key, expr } = await field(f.property);
    if (f.op === "contains") {
      if (p.type !== "list" || typeof f.value !== "string") {
        throw new Invalid(`contains needs a list field and a string`);
      }
      where.push(`(props -> ${key}) ? ${param(f.value)}::text`);
    } else if (f.op === "in") {
      if (!Array.isArray(f.value)) throw new Invalid(`in needs a list`);
      for (const v of f.value) fits(p, v);
      where.push(`${expr} = any(${param(f.value)}::${sqlType[p.type]}[])`);
    } else if (f.op in OPERATORS) {
      fits(p, f.value);
      where.push(
        `${expr} ${OPERATORS[f.op]} ${param(f.value)}::${sqlType[p.type]}`,
      );
    } else {
      throw new Invalid(`"${String(f.op)}" is not a filter`);
    }
  }

  let order = "coalesce(occurred_at, created_at)";
  let orderType = "timestamptz";
  let direction: "asc" | "desc" = "desc";
  let keyOf = (r: RecordRow) => (r.occurred_at ?? r.created_at).toISOString();
  if (opts.orderBy) {
    const { p, key, expr } = await field(opts.orderBy.property);
    if (p.type === "list") {
      throw new Invalid(`${opts.kind}.${p.name} is a list and has no order`);
    }
    const wanted = opts.orderBy.direction ?? "asc";
    if (!(wanted in DIRECTIONS)) {
      throw new Invalid(`"${String(wanted)}" is not a direction`);
    }
    where.push(`props ->> ${key} is not null`);
    order = expr;
    orderType = sqlType[p.type];
    direction = DIRECTIONS[wanted];
    keyOf = (r) => String(r.props[p.name]);
  }
  const orderName = `${scope}/${opts.kind ?? ""}/${opts.owner ?? ""}/${opts.orderBy?.property ?? ""}/${direction}`;
  if (opts.cursor) {
    const c = decode(opts.cursor, orderName);
    if (!keyFits(orderType, c.key)) throw new Invalid("that is not a cursor");
    where.push(
      `(${order}, id) ${direction === "desc" ? "<" : ">"} (${param(c.key)}::${orderType}, ${param(c.id)}::uuid)`,
    );
  }

  const { rows } = await q.query<RecordRow>(
    `select ${recordSelect} from records r
     where ${where.join("\n       and ")}
     order by ${order} ${direction}, id ${direction}
     limit ${param(limit + 1)}`,
    params,
  );
  const page = rows.slice(0, limit).map(toRecord);
  const last = rows.length > limit ? rows[limit - 1] : undefined;
  return {
    records: page,
    cursor: last
      ? encode({ key: keyOf(last), id: last.id, order: orderName })
      : null,
  };
}

// Records by id, in no particular order. Missing ids are simply absent.
export async function get(q: Query, ids: string[]): Promise<BrainRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query<RecordRow>(
    `select ${recordSelect} from records where id = any($1::uuid[])`,
    [ids],
  );
  return rows.map(toRecord);
}

// Every edge touching a record or anything merged into it, however many
// merges deep, in either direction; optionally only those carrying one verb.
export async function edgesOf(
  q: Query,
  id: string,
  verb?: string,
): Promise<Edge[]> {
  const { rows } = await q.query<EdgeRow>(
    `select ${edgeColumns} from edges
     where (from_id in (select same_record($1)) or to_id in (select same_record($1)))
       and ($2::text is null or verb = $2)
     order by coalesce(occurred_at, created_at), id`,
    [id, verb ?? null],
  );
  return rows.map(toEdge);
}

// A record's id and the ids of everything merged into it, however many
// merges deep.
export async function aliasesOf(q: Query, id: string): Promise<string[]> {
  const { rows } = await q.query<{ id: string }>(
    "select same_record($1) as id",
    [id],
  );
  return rows.map((r) => r.id);
}

export type Graph = {
  nodes: { id: string; kind: string; title: string }[];
  edges: Edge[];
};

// What every record stands for, and every edge read between what its ends
// stand for: a merged record's links show on its winner.
const STANDING = `
  with recursive up as (
    select id, id as at, merged_into from records
    union all
    select up.id, r.id, r.merged_into
    from up join records r on r.id = up.merged_into
  ), winner as (
    select id, at as winner from up where merged_into is null
  ), resolved as (
    select distinct on (wf.winner, e.verb, wt.winner)
      e.id, wf.winner as from_id, e.verb, wt.winner as to_id, e.props,
      e.confidence, e.occurred_at, e.source, e.source_ref, e.author,
      e.created_at
    from edges e
    join winner wf on wf.id = e.from_id
    join winner wt on wt.id = e.to_id
    where wf.winner <> wt.winner
    order by wf.winner, e.verb, wt.winner, e.created_at, e.id
  )`;

// The brain as a graph: live records and the edges between them. Given
// records to look around, only those, their neighbours and the edges among
// them; a record looked around is on the map even when deleted, and a
// merged one is looked around as its winner.
export async function graph(q: Query, around?: string[]): Promise<Graph> {
  const { rows: nodes } = await q.query<{
    id: string;
    kind: string;
    title: string;
  }>(
    `${STANDING}, focus as (
       select winner from winner where id = any($1::uuid[])
     ), near as (
       select from_id as id from resolved
       where to_id in (select winner from focus)
       union select to_id from resolved
       where from_id in (select winner from focus)
       union select winner from focus
     )
     select r.id, r.kind, r.title from records r
     where r.merged_into is null
       and (r.deleted_at is null or r.id = any($1::uuid[]))
       and ($1::uuid[] is null or r.id in (select id from near))
     order by r.id`,
    [around ?? null],
  );
  const ids = nodes.map((n) => n.id);
  const { rows: edges } = await q.query<EdgeRow>(
    `${STANDING}
     select ${edgeColumns} from resolved
     where from_id = any($1::uuid[]) and to_id = any($1::uuid[])
     order by id`,
    [ids],
  );
  return { nodes, edges: edges.map(toEdge) };
}

// What changed after a point in the log. Start from 0 for everything.
export async function changes(
  q: Query,
  after: number,
  limit = DEFAULT_LIMIT,
): Promise<Event[]> {
  const { rows } = await q.query<EventRow>(
    `select ${eventColumns} from events where seq > $1 order by seq limit $2`,
    [after, Math.min(Math.max(limit, 1), MAX_LIMIT)],
  );
  return rows.map(toEvent);
}

// The log read backwards, newest first, as a person looks at it.
export async function history(
  q: Query,
  opts: HistoryOptions = {},
): Promise<Event[]> {
  const { rows } = await q.query<EventRow>(
    `select ${eventColumns} from events
     where ($1::uuid is null or subject_id = $1)
       and ($2::bigint is null or seq < $2)
     order by seq desc limit $3`,
    [
      opts.of ?? null,
      opts.before ?? null,
      Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    ],
  );
  return rows.map(toEvent);
}
