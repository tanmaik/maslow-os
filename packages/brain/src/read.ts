import { Invalid } from "./errors.ts";
import { accepts, expected, propertiesOf, sqlType } from "./properties.ts";
import {
  edgeColumns,
  eventColumns,
  recordColumns,
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
  kind?: string;
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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// A page ends at a sort key and an id; the next page starts after them.
type Cursor = { key: string; id: string };
const encode = (c: Cursor) =>
  Buffer.from(JSON.stringify(c)).toString("base64url");
const decode = (s: string): Cursor =>
  JSON.parse(Buffer.from(s, "base64url").toString());

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
  const params: unknown[] = [
    opts.includeDeleted ?? false,
    opts.kind ?? null,
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
    "($3::text is null or layer = $3)",
    "($4::text is null or source = $4)",
    `($5::uuid is null or (
       r.id not in (select same_record($5))
       and exists (
         select 1 from edges e
         join records p
           on p.id = case when e.from_id = r.id then e.to_id else e.from_id end
         where (e.from_id = r.id or e.to_id = r.id)
           and p.id in (select same_record($5)))))`,
    "($6::timestamptz is null or coalesce(occurred_at, created_at) >= $6)",
    "($7::timestamptz is null or coalesce(occurred_at, created_at) < $7)",
    "($8::text is null or search @@ websearch_to_tsquery('english', $8))",
  ];
  const param = (value: unknown) => `$${params.push(value)}`;

  // Declared fields are read out of props and compared as their type.
  let form: Map<string, Property> | null = null;
  const field = async (name: string) => {
    if (!opts.kind) throw new Invalid(`filtering by "${name}" needs a kind`);
    form ??= await propertiesOf(q, opts.kind);
    const p = form.get(name);
    if (!p) throw new Invalid(`${opts.kind} has no field "${name}"`);
    return { p, expr: `(props ->> ${param(p.name)})::${sqlType[p.type]}` };
  };
  // A filter's value must be what the field says, so the database never
  // sees a cast it cannot make.
  const fits = (p: Property, v: unknown) => {
    if (!accepts(p, v)) {
      throw new Invalid(`${opts.kind}.${p.name} filter must be ${expected(p)}`);
    }
  };
  for (const f of opts.where ?? []) {
    const { p, expr } = await field(f.property);
    if (f.op === "contains") {
      if (p.type !== "list" || typeof f.value !== "string") {
        throw new Invalid(`contains needs a list field and a string`);
      }
      where.push(`(props -> ${param(p.name)}) ? ${param(f.value)}::text`);
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
    const { p, expr } = await field(opts.orderBy.property);
    if (p.type === "list") {
      throw new Invalid(`${opts.kind}.${p.name} is a list and has no order`);
    }
    const wanted = opts.orderBy.direction ?? "asc";
    if (!(wanted in DIRECTIONS)) {
      throw new Invalid(`"${String(wanted)}" is not a direction`);
    }
    where.push(`props ->> ${param(p.name)} is not null`);
    order = expr;
    orderType = sqlType[p.type];
    direction = DIRECTIONS[wanted];
    keyOf = (r) => String(r.props[p.name]);
  }
  if (opts.cursor) {
    const c = decode(opts.cursor);
    where.push(
      `(${order}, id) ${direction === "desc" ? "<" : ">"} (${param(c.key)}::${orderType}, ${param(c.id)}::uuid)`,
    );
  }

  const { rows } = await q.query<RecordRow>(
    `select ${recordColumns} from records r
     where ${where.join("\n       and ")}
     order by ${order} ${direction}, id ${direction}
     limit ${param(limit + 1)}`,
    params,
  );
  const page = rows.slice(0, limit).map(toRecord);
  const last = rows.length > limit ? rows[limit - 1] : undefined;
  return {
    records: page,
    cursor: last ? encode({ key: keyOf(last), id: last.id }) : null,
  };
}

// Records by id, in no particular order. Missing ids are simply absent.
export async function get(q: Query, ids: string[]): Promise<BrainRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query<RecordRow>(
    `select ${recordColumns} from records where id = any($1::uuid[])`,
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
