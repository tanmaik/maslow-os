import { Conflict, Invalid, NotFound } from "./errors.ts";
import { check, propertiesOf } from "./properties.ts";
import { recordColumns, toRecord, type RecordRow } from "./rows.ts";
import type {
  Author,
  BrainRecord,
  EdgeInput,
  Property,
  Query,
  RecordInput,
  Ref,
} from "./types.ts";

// Inserts a record, or updates the one with the same source and ref when its
// content differs. Returns nothing when the record is already as written.
const UPSERT = `
insert into records
  (kind, layer, source, source_ref, title, body, props, occurred_at,
   confidence, author)
values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::real, $10)
on conflict (org_id, person_id, source, source_ref) do update set
  kind = excluded.kind, layer = excluded.layer, title = excluded.title,
  body = excluded.body, props = excluded.props,
  occurred_at = excluded.occurred_at, confidence = excluded.confidence,
  author = excluded.author,
  deleted_at = case when records.merged_into is null then null
    else records.deleted_at end
where (records.kind, records.layer, records.title, records.body,
       records.props, records.occurred_at, records.confidence,
       case when records.merged_into is null then records.deleted_at end)
  is distinct from
      (excluded.kind, excluded.layer, excluded.title, excluded.body,
       excluded.props, excluded.occurred_at, excluded.confidence,
       null::timestamptz)
returning id`;

const BY_REF = "select id from records where source = $1 and source_ref = $2";

const refKey = (source: string, sourceRef: string) =>
  JSON.stringify([source, sourceRef]);

async function resolve(
  q: Query,
  ref: Ref,
  written: Map<string, string>,
): Promise<string> {
  if ("id" in ref) return ref.id;
  const known = written.get(refKey(ref.source, ref.sourceRef));
  if (known) return known;
  const { rows } = await q.query<{ id: string }>(BY_REF, [
    ref.source,
    ref.sourceRef,
  ]);
  if (!rows[0]) {
    throw new NotFound(
      `no record from ${ref.source} with ref ${ref.sourceRef} in this brain`,
    );
  }
  return rows[0].id;
}

// The names this brain has defined, read once per call. A name it has not is
// refused before anything is written.
async function vocabulary(q: Query) {
  const names = async (table: "record_kinds" | "edge_verbs") =>
    new Set(
      (await q.query<{ name: string }>(`select name from ${table}`)).rows.map(
        (r) => r.name,
      ),
    );
  const [kinds, verbs] = [
    await names("record_kinds"),
    await names("edge_verbs"),
  ];
  const forms = new Map<string, Promise<Map<string, Property>>>();
  const defined = (what: "kind" | "verb", name: string) => {
    if (!(what === "kind" ? kinds : verbs).has(name)) {
      throw new Invalid(
        `no ${what} "${name}" in this brain; define it, with a description, first`,
      );
    }
  };
  return {
    kind(name: string) {
      defined("kind", name);
      let form = forms.get(name);
      if (!form) {
        form = propertiesOf(q, name);
        forms.set(name, form);
      }
      return form;
    },
    verb(name: string) {
      defined("verb", name);
    },
  };
}

export type Written = {
  // Ids of the input records, in order.
  records: string[];
  // How many of them were new or changed, and how many edges were.
  changed: number;
  edges: number;
};

// Writes records and edges as one author. Idempotent: the same input twice
// leaves the brain as it was. Each record must fit its kind's form. Edges may
// name records written in the same call.
export async function write(
  q: Query,
  author: Author,
  input: { records?: RecordInput[]; edges?: EdgeInput[] },
): Promise<Written> {
  const known = await vocabulary(q);
  const ids: string[] = [];
  let changed = 0;
  const written = new Map<string, string>();
  for (const r of input.records ?? []) {
    const props = r.props ?? {};
    check(r.kind, props, await known.kind(r.kind));
    const upsert = await q.query<{ id: string }>(UPSERT, [
      r.kind,
      r.layer,
      r.source,
      r.sourceRef,
      r.title ?? "",
      r.body ?? "",
      JSON.stringify(props),
      r.occurredAt ?? null,
      r.confidence ?? null,
      author,
    ]);
    let id = upsert.rows[0]?.id;
    if (id) changed += 1;
    else {
      const existing = await q.query<{ id: string }>(BY_REF, [
        r.source,
        r.sourceRef,
      ]);
      id = existing.rows[0]?.id;
      if (!id) throw new Error(`${r.source}:${r.sourceRef} was not written`);
    }
    ids.push(id);
    written.set(refKey(r.source, r.sourceRef), id);
  }

  let edges = 0;
  for (const e of input.edges ?? []) {
    known.verb(e.verb);
    const fromId = await resolve(q, e.from, written);
    const toId = await resolve(q, e.to, written);
    const result = await q.query(
      `insert into edges
           (from_id, verb, to_id, props, confidence, occurred_at, source,
            source_ref, author)
         values ($1, $2, $3, $4::jsonb, $5::real, $6::timestamptz, $7, $8, $9)
         on conflict (org_id, from_id, verb, to_id) do update set
           props = excluded.props, confidence = excluded.confidence,
           occurred_at = excluded.occurred_at, source = excluded.source,
           source_ref = excluded.source_ref, author = excluded.author
         where (edges.props, edges.confidence, edges.occurred_at)
           is distinct from
               (excluded.props, excluded.confidence, excluded.occurred_at)`,
      [
        fromId,
        e.verb,
        toId,
        JSON.stringify(e.props ?? {}),
        e.confidence ?? null,
        e.occurredAt ?? null,
        e.source,
        e.sourceRef ?? null,
        author,
      ],
    );
    edges += result.rowCount ?? 0;
  }
  return { records: ids, changed, edges };
}

export type Patch = {
  kind?: string;
  title?: string;
  body?: string;
  props?: Record<string, unknown>;
  occurredAt?: Date | string;
  confidence?: number;
};

// Changes a record from the version the caller read. A stale version is a
// Conflict; the caller reads again and decides. New props replace the old and
// must fit the kind's form.
export async function edit(
  q: Query,
  author: Author,
  id: string,
  version: number,
  patch: Patch,
): Promise<BrainRecord> {
  if (patch.props || patch.kind) {
    const current = await q.query<{
      kind: string;
      props: Record<string, unknown>;
    }>("select kind, props from records where id = $1 and deleted_at is null", [
      id,
    ]);
    if (!current.rows[0])
      throw new NotFound(`record ${id} is not in this brain`);
    const kind = patch.kind ?? current.rows[0].kind;
    check(
      kind,
      patch.props ?? current.rows[0].props,
      await propertiesOf(q, kind),
    );
  }
  const { rows } = await q.query<RecordRow>(
    `update records set
       kind = coalesce($3, kind),
       title = coalesce($4, title),
       body = coalesce($5, body),
       props = coalesce($6::jsonb, props),
       occurred_at = coalesce($7::timestamptz, occurred_at),
       confidence = coalesce($8::real, confidence),
       author = $9
     where id = $1 and version = $2 and deleted_at is null
     returning ${recordColumns}`,
    [
      id,
      version,
      patch.kind ?? null,
      patch.title ?? null,
      patch.body ?? null,
      patch.props ? JSON.stringify(patch.props) : null,
      patch.occurredAt ?? null,
      patch.confidence ?? null,
      author,
    ],
  );
  if (rows[0]) return toRecord(rows[0]);
  const current = await q.query<{ version: number }>(
    "select version from records where id = $1 and deleted_at is null",
    [id],
  );
  if (!current.rows[0]) throw new NotFound(`record ${id} is not in this brain`);
  throw new Conflict(
    `record ${id} is at version ${current.rows[0].version}, not ${version}`,
  );
}

// Hides a record. Its row and its history stay; restore brings it back.
export async function remove(q: Query, author: Author, id: string) {
  const result = await q.query(
    "update records set deleted_at = now(), author = $2 where id = $1 and deleted_at is null",
    [id, author],
  );
  if (!result.rowCount) throw new NotFound(`record ${id} is not in this brain`);
}

export async function restore(q: Query, author: Author, id: string) {
  const result = await q.query(
    "update records set deleted_at = null, author = $2 where id = $1 and deleted_at is not null and merged_into is null",
    [id, author],
  );
  if (result.rowCount) return;
  const merged = await q.query(
    "select 1 from records where id = $1 and merged_into is not null",
    [id],
  );
  if (merged.rowCount) throw new Invalid(`record ${id} is merged; unmerge it`);
  throw new NotFound(`record ${id} is not deleted`);
}

// Makes one record stand for another of the same kind. The loser is hidden
// and points at the winner; its edges stay where they are and reads follow
// them. Merging the same pair twice changes nothing.
export async function merge(
  q: Query,
  author: Author,
  into: string,
  id: string,
): Promise<BrainRecord> {
  if (into === id) throw new Invalid("a record cannot merge into itself");
  const { rows } = await q.query<RecordRow>(
    `select ${recordColumns} from records where id = any($1::uuid[]) for update`,
    [[into, id]],
  );
  const winner = rows.find((r) => r.id === into);
  const loser = rows.find((r) => r.id === id);
  if (!winner || winner.deleted_at) {
    throw new NotFound(`record ${into} is not in this brain`);
  }
  if (!loser) throw new NotFound(`record ${id} is not in this brain`);
  if (loser.merged_into === into) return toRecord(winner);
  if (loser.deleted_at) throw new Invalid(`record ${id} is deleted`);
  if (loser.kind !== winner.kind) {
    throw new Invalid(`a ${loser.kind} cannot merge into a ${winner.kind}`);
  }
  await q.query(
    "update records set merged_into = $1, author = $3 where merged_into = $2",
    [into, id, author],
  );
  await q.query(
    "update records set deleted_at = now(), merged_into = $1, author = $3 where id = $2",
    [into, id, author],
  );
  return toRecord(winner);
}

// Undoes a merge: the record comes back as itself. Aliases that had been
// pointed at the winner along with it stay with the winner.
export async function unmerge(q: Query, author: Author, id: string) {
  const result = await q.query(
    "update records set deleted_at = null, merged_into = null, author = $2 where id = $1 and merged_into is not null",
    [id, author],
  );
  if (!result.rowCount) throw new NotFound(`record ${id} is not merged`);
}
