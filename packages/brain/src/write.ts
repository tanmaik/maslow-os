import { defineType, type TypeDefinition } from "./catalog.ts";
import { Invalid, Forbidden, NotFound } from "./errors.ts";
import { check, holdType, plain, propertiesOf } from "./properties.ts";
import {
  recordColumns,
  recordSelect,
  toRecord,
  type RecordRow,
} from "./rows.ts";
import { need } from "./share.ts";
import { refuse } from "./vocabulary.ts";
import type {
  BrainRecord,
  EdgeInput,
  Property,
  Query,
  RecordInput,
  Ref,
} from "./types.ts";

// Inserts a record, or updates the one with the same source and ref when its
// content differs. Returns nothing when the record is already as written. A
// record from nowhere in particular is from the brain, under a fresh id.
const UPSERT = `
insert into records
  (type, source, source_ref, title, body, props, occurred_at, confidence)
values ($1, coalesce($2, 'brain'), coalesce($3, short_id()), $4, $5,
        $6::jsonb, $7::timestamptz, $8::real)
on conflict (org_id, person_id, source, source_ref) do update set
  type = excluded.type, title = excluded.title,
  body = excluded.body, props = excluded.props,
  occurred_at = excluded.occurred_at, confidence = excluded.confidence,
  deleted_at = case when records.merged_into is null then null
    else records.deleted_at end
where (records.type, records.title, records.body, records.props,
       records.occurred_at, records.confidence,
       case when records.merged_into is null then records.deleted_at end)
  is distinct from
      (excluded.type, excluded.title, excluded.body, excluded.props,
       excluded.occurred_at, excluded.confidence, null::timestamptz)
returning id`;

const OWN_BY_REF =
  "select id from records where source = $1 and source_ref = $2 and person_id = current_member()";
const ANY_BY_REF =
  "select id, person_id = current_member() as own from records where source = $1 and source_ref = $2";

const refKey = (source: string, sourceRef: string) =>
  JSON.stringify([source, sourceRef]);

async function resolve(
  q: Query,
  ref: Ref,
  written: Map<string, string>,
  ids: string[],
): Promise<string> {
  if ("id" in ref) return ref.id;
  if ("index" in ref) {
    const id = ids[ref.index];
    if (id === undefined) {
      throw new Invalid(`no record ${ref.index} in this call`);
    }
    return id;
  }
  const known = written.get(refKey(ref.source, ref.sourceRef));
  if (known) return known;
  const { rows } = await q.query<{ id: string; own: boolean }>(ANY_BY_REF, [
    ref.source,
    ref.sourceRef,
  ]);
  const own = rows.find((r) => r.own);
  if (own) return own.id;
  if (rows.length > 1) {
    throw new Invalid(
      `${rows.length} records from ${ref.source} carry ref ${ref.sourceRef}; name one by id`,
    );
  }
  if (!rows[0]) {
    throw new NotFound(
      `no record from ${ref.source} with ref ${ref.sourceRef} in this brain`,
    );
  }
  return rows[0].id;
}

// The types the call writes, each held until it commits, in one order so
// two writes never wait on each other in a circle. A name the person has
// not defined, or one gone by the time it is held, is refused before
// anything is written.
async function forms(q: Query, types: string[]) {
  const held = new Map<string, Map<string, Property>>();
  for (const name of [...new Set(types)].sort()) {
    if (!(await holdType(q, name, false))) {
      await refuse(q, name).catch((err) => {
        if (err instanceof NotFound) {
          throw new Invalid(
            `no type "${name}" in your vocabulary; define it first`,
          );
        }
        throw err;
      });
    }
    held.set(name, await propertiesOf(q, name));
  }
  return (name: string) => held.get(name)!;
}

// A name written to be read back unquoted must print.
function printable(what: string, s: string) {
  if (!s.trim() || !plain(s)) {
    throw new Invalid(`${what} must print: ${JSON.stringify(s)}`);
  }
}

export type Written = {
  // Ids of the input records, in order.
  records: string[];
  // How many of them were new or changed, and how many edges were.
  changed: number;
  edges: number;
  // What the call added to the vocabulary: "type x", "field x.y".
  defined: string[];
};

// Writes records and edges, defining any types the brain does not have yet
// in the same call. Idempotent: the same input twice leaves the brain as it
// was. Each record must fit its type's form. Edges may name records written
// in the same call.
export async function write(
  q: Query,
  input: {
    types?: TypeDefinition[];
    records?: RecordInput[];
    edges?: EdgeInput[];
  },
): Promise<Written> {
  const defined: string[] = [];
  const byName = [...(input.types ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const t of byName) {
    const type = await defineType(q, t);
    if (type.created) defined.push(`type ${type.name}`);
    defined.push(...type.added.map((f) => `field ${type.name}.${f}`));
  }
  const form = await forms(
    q,
    (input.records ?? []).map((r) => r.type),
  );
  const ids: string[] = [];
  let changed = 0;
  const written = new Map<string, string>();
  for (const r of input.records ?? []) {
    const props = r.props ?? {};
    check(r.type, props, form(r.type));
    if ((r.source === undefined) !== (r.sourceRef === undefined)) {
      throw new Invalid("a source and its ref come together");
    }
    if (r.source !== undefined) {
      printable("a source", r.source);
      printable("a source ref", r.sourceRef!);
    }
    const upsert = await q.query<{ id: string }>(UPSERT, [
      r.type,
      r.source ?? null,
      r.sourceRef ?? null,
      r.title ?? "",
      r.body ?? "",
      JSON.stringify(props),
      r.occurredAt ?? null,
      r.confidence ?? null,
    ]);
    let id = upsert.rows[0]?.id;
    if (id) changed += 1;
    else {
      const existing = await q.query<{ id: string }>(OWN_BY_REF, [
        r.source,
        r.sourceRef,
      ]);
      id = existing.rows[0]?.id;
      if (!id) throw new Error(`${r.source}:${r.sourceRef} was not written`);
    }
    ids.push(id);
    if (r.source !== undefined) {
      written.set(refKey(r.source, r.sourceRef!), id);
    }
  }

  let edges = 0;
  for (const e of input.edges ?? []) {
    printable("a verb", e.verb);
    const fromId = await resolve(q, e.from, written, ids);
    const toId = await resolve(q, e.to, written, ids);
    if (fromId === toId) {
      throw new Invalid(
        `an edge joins two records; ${fromId} cannot ${e.verb} itself`,
      );
    }
    await need(q, fromId, "edit");
    await need(q, toId, "view");
    const result = await q.query(
      `insert into edges
           (from_id, verb, to_id, props, confidence, occurred_at)
         values ($1, $2, $3, $4::jsonb, $5::real, $6::timestamptz)
         on conflict (org_id, from_id, verb, to_id) do update set
           props = excluded.props, confidence = excluded.confidence,
           occurred_at = excluded.occurred_at, deleted_at = null
         where (edges.props, edges.confidence, edges.occurred_at, edges.deleted_at)
           is distinct from
               (excluded.props, excluded.confidence, excluded.occurred_at, null)`,
      [
        fromId,
        e.verb,
        toId,
        JSON.stringify(e.props ?? {}),
        e.confidence ?? null,
        e.occurredAt ?? null,
      ],
    );
    edges += result.rowCount ?? 0;
  }
  return { records: ids, changed, edges, defined };
}

// Hides a link. Its row and its history stay; restore brings it back.
export async function unlink(q: Query, id: string) {
  const result = await q.query(
    "update edges set deleted_at = now() where id = $1 and deleted_at is null",
    [id],
  );
  if (result.rowCount) return;
  const seen = await q.query(
    "select 1 from edges where id = $1 and deleted_at is null",
    [id],
  );
  if (seen.rowCount)
    throw new Forbidden("you may see this link, not remove it");
  throw new NotFound(`edge ${id} is not in this brain`);
}

// Brings a hidden link back.
export async function restoreEdge(q: Query, id: string) {
  const result = await q.query(
    "update edges set deleted_at = null where id = $1 and deleted_at is not null",
    [id],
  );
  if (!result.rowCount) throw new NotFound(`edge ${id} is not hidden`);
}

export type Patch = {
  type?: string;
  title?: string;
  body?: string;
  props?: Record<string, unknown>;
  // Null takes the time away; absent leaves it.
  occurredAt?: Date | string | null;
  confidence?: number | null;
};

// Changes a record. New props replace the old and must fit the type's form.
export async function edit(
  q: Query,
  id: string,
  patch: Patch,
): Promise<BrainRecord> {
  await need(q, id, "edit");
  const current = await q.query<{
    type: string;
    props: Record<string, unknown>;
    person_id: string;
  }>(
    "select type, props, person_id from records where id = $1 and deleted_at is null",
    [id],
  );
  if (!current.rows[0]) throw new NotFound(`record ${id} is not in this brain`);
  if (patch.props || patch.type) {
    const type = patch.type ?? current.rows[0].type;
    check(
      type,
      patch.props ?? current.rows[0].props,
      await propertiesOf(q, type, current.rows[0].person_id, true),
    );
  }
  const { rows } = await q.query<RecordRow>(
    `update records set
       type = coalesce($2, type),
       title = coalesce($3, title),
       body = coalesce($4, body),
       props = coalesce($5::jsonb, props),
       occurred_at = case when $7::boolean then $6::timestamptz
         else occurred_at end,
       confidence = case when $9::boolean then $8::real else confidence end
     where id = $1 and deleted_at is null
     returning ${recordSelect}`,
    [
      id,
      patch.type ?? null,
      patch.title ?? null,
      patch.body ?? null,
      patch.props ? JSON.stringify(patch.props) : null,
      patch.occurredAt ?? null,
      patch.occurredAt !== undefined,
      patch.confidence ?? null,
      patch.confidence !== undefined,
    ],
  );
  if (!rows[0]) throw new NotFound(`record ${id} is not in this brain`);
  return toRecord(rows[0]);
}

// Hides a record. Its row and its history stay; restore brings it back.
export async function remove(q: Query, id: string) {
  await need(q, id, "owner");
  const result = await q.query(
    "update records set deleted_at = now() where id = $1 and deleted_at is null",
    [id],
  );
  if (!result.rowCount) throw new NotFound(`record ${id} is not in this brain`);
}

// Brings a removed record back, under a type that is there. The type is
// held until the transaction commits, so it cannot be removed underneath.
export async function restore(q: Query, id: string) {
  await need(q, id, "owner");
  const { rows: of } = await q.query<{ type: string }>(
    "select type from records where id = $1",
    [id],
  );
  if (of[0] && !(await holdType(q, of[0].type, false))) {
    throw new Invalid(
      `record ${id} is a ${of[0].type}, which is removed; restore the type first`,
    );
  }
  const result = await q.query(
    "update records set deleted_at = null where id = $1 and deleted_at is not null and merged_into is null",
    [id],
  );
  if (result.rowCount) return;
  const merged = await q.query(
    "select 1 from records where id = $1 and merged_into is not null",
    [id],
  );
  if (merged.rowCount) throw new Invalid(`record ${id} is merged; unmerge it`);
  throw new NotFound(`record ${id} is not deleted`);
}

// What a record stands for: itself, or the live record at the end of its
// chain of merges.
const STANDS_FOR = `
with recursive chain as (
  select ${recordColumns}, 0 as depth from records where id = $1
  union all
  select ${recordColumns
    .split(", ")
    .map((c) => `r.${c}`)
    .join(", ")}, chain.depth + 1
  from records r join chain on r.id = chain.merged_into)
select chain.*, access_level(chain.id) as access
from chain order by depth desc limit 1`;

// Makes one record stand for another of the same type and the same owner.
// The loser is hidden behind a pointer to the winner and nothing else is
// rewritten: what was merged into the loser stays merged into it, and reads
// walk the chain. Merging into an alias merges into what it stands for.
// Merging the same pair twice changes nothing. Both rows are locked, in one
// order, so two merges racing in opposite directions cannot close a cycle.
export async function merge(
  q: Query,
  into: string,
  id: string,
): Promise<BrainRecord> {
  await need(q, id, "owner");
  for (;;) {
    const winner = (await q.query<RecordRow>(STANDS_FOR, [into])).rows[0];
    if (!winner || winner.deleted_at) {
      throw new NotFound(`record ${into} is not in this brain`);
    }
    await need(q, winner.id, "owner");
    if (winner.id === id) {
      throw new Invalid("a record cannot merge into itself");
    }
    const locked = (
      await q.query<RecordRow>(
        `select ${recordSelect} from records where id = any($1::text[])
         order by id for update`,
        [[winner.id, id]],
      )
    ).rows;
    const held = locked.find((r) => r.id === winner.id);
    const loser = locked.find((r) => r.id === id);
    if (!held || held.deleted_at) continue; // merged meanwhile: resolve again
    if (!loser) throw new NotFound(`record ${id} is not in this brain`);
    if (loser.merged_into === winner.id) return toRecord(held);
    if (loser.deleted_at) throw new Invalid(`record ${id} is deleted`);
    if (loser.type !== winner.type) {
      throw new Invalid(`a ${loser.type} cannot merge into a ${winner.type}`);
    }
    if (loser.person_id !== held.person_id) {
      throw new Invalid("two people's records do not merge; share one instead");
    }
    await q.query(
      "update records set deleted_at = now(), merged_into = $1 where id = $2",
      [winner.id, id],
    );
    return toRecord(held);
  }
}

// Undoes a merge: the record comes back as itself, and whatever was merged
// into it comes back with it, since nothing was rewritten.
export async function unmerge(q: Query, id: string) {
  await need(q, id, "owner");
  const result = await q.query(
    "update records set deleted_at = null, merged_into = null where id = $1 and merged_into is not null",
    [id],
  );
  if (!result.rowCount) throw new NotFound(`record ${id} is not merged`);
}
