import { Invalid } from "./errors.ts";
import { recordColumns, toRecord, type RecordRow } from "./rows.ts";
import type { BrainRecord, Query } from "./types.ts";

// Finding records by meaning. The brain keeps a vector per record and
// compares a question's vector against them; making vectors is the app's,
// through whatever model it has, and the doors here only store and rank.

// The text a record is embedded from: what it is, what it says, what it
// holds. Cut so no record costs more than a page.
const MOST = 8000;
const textOf = (r: {
  kind: string;
  title: string;
  body: string;
  props: Record<string, unknown>;
}) =>
  `${r.kind}: ${r.title}\n${r.body}${
    Object.keys(r.props).length ? `\n${JSON.stringify(r.props)}` : ""
  }`.slice(0, MOST);

// The record columns as r, beside a joined table.
const OF_R = `${recordColumns
  .split(", ")
  .map((c) => `r.${c}`)
  .join(", ")}, access_level(r.id) as access`;

// The change a vector is made from is carried as the database writes it,
// to the microsecond, so it comes back equal.
export type Stale = { id: string; text: string; asOf: string };

// Live records the member sees whose vector was made before their last
// change, or never: at most `limit`, oldest change first. The member's
// catch-up is held for the transaction, so two asking at once never embed
// the same records.
export async function stale(
  q: Query,
  model: string,
  limit = 100,
): Promise<Stale[]> {
  await q.query(
    "select pg_advisory_xact_lock(hashtext('recall'), hashtext(current_member()::text))",
  );
  const { rows } = await q.query<RecordRow & { as_of: string }>(
    `select ${OF_R}, r.updated_at::text as as_of from records r
     left join record_embeddings e on e.record_id = r.id and e.model = $1
     where r.deleted_at is null and r.merged_into is null
       and (e.record_id is null or e.as_of < r.updated_at)
     order by r.updated_at, r.id limit $2`,
    [model, limit],
  );
  return rows.map((r) => ({ id: r.id, text: textOf(r), asOf: r.as_of }));
}

// Stores vectors, each as of the change it was made from, replacing any a
// record had.
export async function remember(
  q: Query,
  model: string,
  items: { id: string; embedding: number[]; asOf: string }[],
): Promise<void> {
  for (const it of items) {
    await q.query(
      `insert into record_embeddings (record_id, model, embedding, as_of)
       values ($1, $2, $3::real[], $4::timestamptz)
       on conflict (record_id) do update set
         model = excluded.model, embedding = excluded.embedding,
         as_of = excluded.as_of`,
      [it.id, model, it.embedding, it.asOf],
    );
  }
}

export type RecallOptions = {
  kind?: string;
  since?: Date;
  until?: Date;
  limit?: number;
};

export type Recalled = { record: BrainRecord; score: number };

const MAX_LIMIT = 50;

// The records nearest a vector, best first, with how near. Vectors are unit
// length, so the dot product is the cosine.
export async function recall(
  q: Query,
  model: string,
  vector: number[],
  opts: RecallOptions = {},
): Promise<Recalled[]> {
  if (!vector.length) throw new Invalid("a question needs a vector");
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), MAX_LIMIT);
  const { rows } = await q.query<RecordRow & { score: number }>(
    `with scored as (
       select e.record_id,
         (select sum(a * b) from unnest(e.embedding, $2::real[]) as v(a, b))
           as score
       from record_embeddings e
       where e.model = $1
     )
     select ${OF_R}, s.score::float8 as score
     from scored s join records r on r.id = s.record_id
     where r.deleted_at is null and r.merged_into is null
       and ($3::text is null or r.kind = $3)
       and ($4::timestamptz is null or coalesce(r.occurred_at, r.created_at) >= $4)
       and ($5::timestamptz is null or coalesce(r.occurred_at, r.created_at) < $5)
     order by s.score desc, r.id
     limit $6`,
    [
      model,
      vector,
      opts.kind ?? null,
      opts.since ?? null,
      opts.until ?? null,
      limit,
    ],
  );
  return rows.map((r) => ({ record: toRecord(r), score: r.score }));
}
