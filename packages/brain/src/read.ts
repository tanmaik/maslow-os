import { Invalid } from "./errors.ts";
import { isId } from "./ids.ts";
import { accepts, expected, propertiesOf, sqlType } from "./properties.ts";
import {
  edgeColumns,
  eventColumns,
  openingSelect,
  recordSelect,
  stubSelect,
  toEdge,
  toEvent,
  toRecord,
  toStub,
  type EdgeRow,
  type EventRow,
  type RecordRow,
} from "./rows.ts";
import type {
  BrainRecord,
  Edge,
  Event,
  Filter,
  Property,
  Query,
  Sort,
  Stub,
} from "./types.ts";

export type ReadOptions = {
  // Whose records: everything the reader may see, their own, or what others
  // shared with them.
  scope?: "mine" | "shared" | "all";
  // Records of every type with this name the reader may see; owner narrows
  // to one person's.
  type?: string;
  owner?: string;
  // A person record's id: only records linked to it by an edge.
  person?: string;
  since?: Date;
  until?: Date;
  // Plain words, quoted phrases and -exclusions, as a search box takes them.
  query?: string;
  // Conditions on the type's declared fields; need a type. A field is one
  // person's declaration, so filtering or ordering by one reads that
  // person's records: the owner's, or the reader's own.
  where?: Filter[];
  // Order by a declared field instead of by time; needs a type. Records
  // without the field are left out.
  orderBy?: Sort;
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string | null;
};

export type Page = { records: BrainRecord[]; cursor: string | null };
export type StubPage = { records: Stub[]; cursor: string | null };

export type HistoryOptions = {
  // Only the changes to one record, edge, type or field.
  of?: string;
  // Only changes before this point in the log; the next page.
  before?: number;
  // Only changes after this point in the log, oldest first: what something
  // watching the brain has not seen yet.
  after?: number;
  limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// A page ends at a sort key and an id, under one order; the next page
// starts after them, under the same order. A null key is the tail of
// records that have no value to sort by.
type Cursor = { key: string | null; id: string; order: string };
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
    (typeof c?.key !== "string" && c?.key !== null) ||
    typeof c.id !== "string" ||
    !isId(c.id)
  ) {
    throw new Invalid("that is not a cursor");
  }
  if (c.order !== order) throw new Invalid("that cursor is from another query");
  return c as Cursor;
}

// Whether a cursor's key can be cast to the column it is compared with.
const keyFits = (type: string, key: string | null) =>
  key === null
    ? true
    : type === "timestamptz" || type === "date"
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
export async function read(
  q: Query,
  opts: ReadOptions = {},
  select: string = recordSelect,
): Promise<Page> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const scope = opts.scope ?? "all";
  if (!["mine", "shared", "all"].includes(scope)) {
    throw new Invalid(`"${String(scope)}" is not a scope`);
  }
  if (opts.owner && !opts.type) throw new Invalid("an owner needs a type");
  const params: unknown[] = [
    opts.includeDeleted ?? false,
    opts.type ?? null,
    opts.owner ?? null,
    opts.person ?? null,
    opts.since ?? null,
    opts.until ?? null,
    opts.query?.trim() || null,
  ];
  const where = [
    "($1::boolean or deleted_at is null)",
    "($2::text is null or type = $2)",
    "($3::uuid is null or person_id = $3)",
    `($4::text is null or (
       r.id not in (select same_record($4))
       and exists (
         select 1 from edges e
         join records p
           on p.id = case when e.from_id = r.id then e.to_id else e.from_id end
         where (e.from_id = r.id or e.to_id = r.id)
           and e.deleted_at is null
           and p.id in (select same_record($4)))))`,
    "($5::timestamptz is null or coalesce(occurred_at, created_at) >= $5)",
    "($6::timestamptz is null or coalesce(occurred_at, created_at) < $6)",
    "($7::text is null or search @@ websearch_to_tsquery('english', $7))",
    scope === "mine"
      ? "person_id = current_member()"
      : scope === "shared"
        ? "person_id <> current_member()"
        : "true",
    opts.where?.length || opts.orderBy
      ? "person_id = coalesce($3, current_member())"
      : "true",
  ];
  const param = (value: unknown) => `$${params.push(value)}`;

  // Declared fields are read out of props and compared as their type: the
  // owner's declaration when one is named, else the reader's own. The
  // field's name is one parameter, whichever way it is read.
  let form: Map<string, Property> | null = null;
  const field = async (name: string) => {
    if (!opts.type) throw new Invalid(`filtering by "${name}" needs a type`);
    form ??= await propertiesOf(q, opts.type, opts.owner);
    const p = form.get(name);
    if (!p) {
      throw new Invalid(
        `${opts.type} has no field "${name}" in ${opts.owner ? "that" : "your"} vocabulary${opts.owner ? "" : "; a colleague's needs owner"}`,
      );
    }
    // Cast only where the declaration holds, whatever order the database
    // tests the conditions in.
    const key = param(p.name);
    return {
      p,
      key,
      expr: `(case when person_id = coalesce($3, current_member())
        then props ->> ${key} end)::${sqlType[p.datatype]}`,
    };
  };
  // A filter's value must be what the field says, so the database never
  // sees a cast it cannot make.
  const fits = (p: Property, v: unknown) => {
    if (!accepts(p, v)) {
      throw new Invalid(`${opts.type}.${p.name} filter must be ${expected(p)}`);
    }
  };
  for (const f of opts.where ?? []) {
    const { p, key, expr } = await field(f.property);
    if (f.op === "contains") {
      if (p.datatype !== "list" || typeof f.value !== "string") {
        throw new Invalid(`contains needs a list field and a string`);
      }
      where.push(`(props -> ${key}) ? ${param(f.value)}::text`);
    } else if (f.op === "in") {
      if (!Array.isArray(f.value)) throw new Invalid(`in needs a list`);
      for (const v of f.value) fits(p, v);
      where.push(`${expr} = any(${param(f.value)}::${sqlType[p.datatype]}[])`);
    } else if (Object.hasOwn(OPERATORS, f.op)) {
      fits(p, f.value);
      where.push(
        `${expr} ${OPERATORS[f.op]} ${param(f.value)}::${sqlType[p.datatype]}`,
      );
    } else {
      throw new Invalid(`"${String(f.op)}" is not a filter`);
    }
  }

  let order = "coalesce(occurred_at, created_at)";
  let orderType = "timestamptz";
  let direction: "asc" | "desc" = "desc";
  if (opts.orderBy) {
    const { p, expr } = await field(opts.orderBy.property);
    if (p.datatype === "list") {
      throw new Invalid(`${opts.type}.${p.name} is a list and has no order`);
    }
    const wanted = opts.orderBy.direction ?? "asc";
    if (!(wanted in DIRECTIONS)) {
      throw new Invalid(`"${String(wanted)}" is not a direction`);
    }
    order = expr;
    orderType = sqlType[p.datatype];
    direction = DIRECTIONS[wanted];
  }
  const orderName = `${scope}/${opts.type ?? ""}/${opts.owner ?? ""}/${opts.orderBy?.property ?? ""}/${direction}`;
  if (opts.cursor) {
    const c = decode(opts.cursor, orderName);
    if (!keyFits(orderType, c.key)) throw new Invalid("that is not a cursor");
    const after = direction === "desc" ? "<" : ">";
    where.push(
      c.key === null
        ? `(${order} is null and id ${after} ${param(c.id)}::text)`
        : `(${order} is null or (${order}, id) ${after} (${param(c.key)}::${orderType}, ${param(c.id)}::text))`,
    );
  }

  // The sort key travels as the database writes it, so the next page
  // starts exactly where this one ended.
  const { rows } = await q.query<RecordRow & { sort_key: string | null }>(
    `select ${select}, to_json(${order}) #>> '{}' as sort_key from records r
     where ${where.join("\n       and ")}
     order by ${order} ${direction} nulls last, id ${direction}
     limit ${param(limit + 1)}`,
    params,
  );
  const page = rows.slice(0, limit).map(toRecord);
  const last = rows.length > limit ? rows[limit - 1] : undefined;
  return {
    records: page,
    cursor: last
      ? encode({ key: last.sort_key, id: last.id, order: orderName })
      : null,
  };
}

// How many live records of the person's own the brain holds.
export async function count(q: Query): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    `select count(*)::int as n from records
     where person_id = current_member()
       and deleted_at is null and merged_into is null`,
  );
  return rows[0]!.n;
}

// How many live records each type holds, the reader's own and every type
// shared into their brain, keyed by whose it is and its name. A type with
// nothing in it is absent.
export async function counts(q: Query): Promise<Map<string, number>> {
  const { rows } = await q.query<{
    person_id: string;
    type: string;
    n: number;
  }>(
    `select person_id, type, count(*)::int as n from records
     where deleted_at is null and merged_into is null
     group by person_id, type`,
  );
  return new Map(rows.map((r) => [`${r.person_id}:${r.type}`, r.n]));
}

// Records by id, in no particular order. Missing ids are simply absent.
export async function get(q: Query, ids: string[]): Promise<BrainRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query<RecordRow>(
    `select ${recordSelect} from records where id = any($1::text[])`,
    [ids],
  );
  return rows.map(toRecord);
}

// Records as a list shows them: the same query, with the bodies left in the
// database. A page of fifty records is a page of fifty titles, not a download
// of everything those records say.
export async function list(
  q: Query,
  opts: ReadOptions = {},
): Promise<StubPage> {
  const page = await read(q, opts, stubSelect);
  return {
    records: page.records.map(({ body: _body, ...rest }) => rest),
    cursor: page.cursor,
  };
}

// Records as a list shows them, with the opening of each body and no more:
// enough for a line under the title, never the whole of a document.
export async function opened(q: Query, opts: ReadOptions = {}): Promise<Page> {
  return read(q, opts, openingSelect);
}

// The same records without their bodies, for a caller that renders titles:
// the ends of a record's links, or the records an ask names.
export async function stubs(q: Query, ids: string[]): Promise<Stub[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query<RecordRow>(
    `select ${stubSelect} from records where id = any($1::text[])`,
    [ids],
  );
  return rows.map(toStub);
}

// Every edge touching a record or anything merged into it, however many
// merges deep, in either direction, whose other end is here: a merged record
// counts as its winner, a removed one does not. Optionally only those
// carrying one verb.
export async function edgesOf(
  q: Query,
  id: string,
  verb?: string,
): Promise<Edge[]> {
  const same = await aliasesOf(q, id);
  const { rows } = await q.query<EdgeRow>(
    `${standing("$1::text[]")}
     select ${edgeColumns.replaceAll(/(^|, )/g, "$1e.")} from touched e
     join winner wf on wf.id = e.from_id
     join winner wt on wt.id = e.to_id
     where ($2::text is null or e.verb = $2)
       and exists (
         select 1 from records o
         where o.id = case when e.from_id = any($1::text[])
           then wt.winner else wf.winner end
           and o.deleted_at is null)
     order by coalesce(e.occurred_at, e.created_at), e.id`,
    [same, verb ?? null],
  );
  return rows.map(toEdge);
}

// The ids of some records and of everything merged into them, however many
// merges deep.
async function sameAs(q: Query, ids: string[]): Promise<string[]> {
  const { rows } = await q.query<{ id: string }>(
    `with recursive same as (
       select id from unnest($1::text[]) as id
       union
       select r.id from records r join same on r.merged_into = same.id
     ) select id from same`,
    [ids],
  );
  return rows.map((r) => r.id);
}

export const aliasesOf = (q: Query, id: string) => sameAs(q, [id]);

export type Graph = {
  // Distance from the records looked around, when any were.
  nodes: { id: string; type: string; title: string; depth: number | null }[];
  edges: Edge[];
};

export type GraphOptions = {
  // How many links out from the records looked around, one by default.
  depth?: number;
  // Only links carrying one of these verbs.
  verbs?: string[];
  // Which way to follow links from a record: the ones it makes, the ones
  // made to it, or both.
  direction?: "out" | "in" | "both";
  // At most this many records, nearest first.
  limit?: number;
};

const MAX_DEPTH = 4;
const MAX_NODES = 500;

// The links around some records, read between what their ends stand for:
// every link touching one of the ids given, and each end followed up to the
// record that stands for it, so a merged record's links show on its winner.
// The ids are a record and everything merged into it, resolved first, so
// the links are reached through their index and what this costs grows with
// the links around them, not with the brain.
const standing = (ids: string) => `
  with recursive touched as (
    select * from edges e
    where e.deleted_at is null
      and (e.from_id = any(${ids}) or e.to_id = any(${ids}))
  ), up as (
    select id, id as at, merged_into from records
    where id in (select from_id from touched union select to_id from touched)
    union all
    select up.id, r.id, r.merged_into
    from up join records r on r.id = up.merged_into
  ), winner as (
    select id, at as winner from up where merged_into is null
  ), resolved as (
    select distinct on (wf.winner, e.verb, wt.winner)
      e.id, wf.winner as from_id, e.verb, wt.winner as to_id,
      e.confidence, e.occurred_at, e.created_at
    from touched e
    join winner wf on wf.id = e.from_id
    join winner wt on wt.id = e.to_id
    where wf.winner <> wt.winner
    order by wf.winner, e.verb, wt.winner, e.created_at, e.id
  )`;

// The brain as a graph: live records and the edges between them. Given
// records to look around, only those, what is within so many links of them
// along the verbs asked for, and the edges among them; a record looked
// around is on the map even when deleted, and a merged one is looked around
// as its winner.
export async function graph(
  q: Query,
  around?: string[],
  opts: GraphOptions = {},
): Promise<Graph> {
  const depth = Math.min(Math.max(opts.depth ?? 1, 0), MAX_DEPTH);
  const direction = opts.direction ?? "both";
  if (!["out", "in", "both"].includes(direction)) {
    throw new Invalid(`"${String(direction)}" is not a direction to follow`);
  }
  const limit = Math.min(Math.max(opts.limit ?? MAX_NODES, 1), MAX_NODES);
  const verbs = opts.verbs?.length ? opts.verbs : null;
  // Which records are on the map and how far each is from where the walk
  // began; with no beginning, every live record, at no distance.
  const found = new Map<string, number | null>();
  if (around) {
    const focus = await q.query<{ winner: string }>(
      `with recursive up as (
         select id, id as at, merged_into from records where id = any($1::text[])
         union all
         select up.id, r.id, r.merged_into
         from up join records r on r.id = up.merged_into
       ) select distinct at as winner from up where merged_into is null`,
      [around],
    );
    for (const f of focus.rows) found.set(f.winner, 0);
    // One link out from the frontier at a time, never from a removed
    // record, never through one, and never past the limit.
    let frontier = [...found.keys()];
    for (let d = 1; d <= depth && frontier.length && found.size < limit; d++) {
      const step = await q.query<{ id: string }>(
        `${standing("$6::text[]")}
         select distinct n.id from resolved e
         join records cur on cur.deleted_at is null and cur.id = case
           when $2 <> 'in' and e.from_id = any($1::text[]) then e.from_id
           when $2 <> 'out' and e.to_id = any($1::text[]) then e.to_id end
         join records n on n.deleted_at is null
           and n.id = case when cur.id = e.from_id then e.to_id else e.from_id end
         where ($3::text[] is null or e.verb = any($3))
           and not (n.id = any($4::text[]))
         order by n.id limit $5`,
        [
          frontier,
          direction,
          verbs,
          [...found.keys()],
          limit - found.size,
          await sameAs(q, frontier),
        ],
      );
      frontier = step.rows.map((r) => r.id);
      for (const id of frontier) found.set(id, d);
    }
  } else {
    const all = await q.query<{ id: string }>(
      `select id from records where merged_into is null and deleted_at is null
       order by id limit $1`,
      [limit],
    );
    for (const r of all.rows) found.set(r.id, null);
  }
  const ids = [...found.keys()];
  const { rows: named } = await q.query<{
    id: string;
    type: string;
    title: string;
  }>(`select id, type, title from records where id = any($1::text[])`, [ids]);
  const nodes = named
    .map((n) => ({ ...n, depth: found.get(n.id) ?? null }))
    .sort(
      (a, b) => (a.depth ?? -1) - (b.depth ?? -1) || a.id.localeCompare(b.id),
    );
  const { rows: edges } = await q.query<EdgeRow>(
    `${standing("$3::text[]")}
     select ${edgeColumns} from resolved
     where from_id = any($1::text[]) and to_id = any($1::text[])
       and ($2::text[] is null or verb = any($2))
     order by id`,
    [ids, verbs, await sameAs(q, ids)],
  );
  return { nodes, edges: edges.map(toEdge) };
}

// The log read backwards, newest first, as a person looks at it; or
// forwards from a point, oldest first, as something watching it does.
export async function history(
  q: Query,
  opts: HistoryOptions = {},
): Promise<Event[]> {
  if (opts.before !== undefined && opts.after !== undefined) {
    throw new Invalid("before or after, not both");
  }
  const forward = opts.after !== undefined;
  const { rows } = await q.query<EventRow>(
    `select ${eventColumns} from events
     where ($1::text is null or subject_id = $1)
       and ($2::bigint is null or seq < $2)
       and ($3::bigint is null or seq > $3)
     order by seq ${forward ? "asc" : "desc"} limit $4`,
    [
      opts.of ?? null,
      opts.before ?? null,
      opts.after ?? null,
      Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    ],
  );
  return rows.map(toEvent);
}
