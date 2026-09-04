import { catalog, defineKind, defineVerb } from "./catalog.ts";
import { Invalid } from "./errors.ts";
import { defineProperty } from "./properties.ts";
import {
  eventColumns,
  recordColumns,
  toEvent,
  type EventRow,
  type RecordRow,
} from "./rows.ts";
import type { Author, Event, Layer, PropertyType, Query } from "./types.ts";
import { merge, write } from "./write.ts";

// One org's brain as a file: the vocabulary, every live record and edge, and
// the log. Edges name their ends by source and ref, never by id, so the file
// imports into any brain.
export type Snapshot = {
  format: "maslow-brain/1";
  exportedAt: string;
  kinds: { name: string; description: string; author: Author }[];
  properties: {
    kind: string;
    name: string;
    type: PropertyType;
    description: string;
    required: boolean;
    options: string[] | null;
    author: Author;
  }[];
  verbs: { name: string; description: string; author: Author }[];
  records: {
    kind: string;
    layer: Layer;
    source: string;
    sourceRef: string;
    title: string;
    body: string;
    props: Record<string, unknown>;
    occurredAt: string | null;
    confidence: number | null;
    author: Author;
    // Set when this record was merged into the one named.
    mergedInto: { source: string; sourceRef: string } | null;
  }[];
  edges: {
    from: { source: string; sourceRef: string };
    verb: string;
    to: { source: string; sourceRef: string };
    props: Record<string, unknown>;
    confidence: number | null;
    occurredAt: string | null;
    source: string;
    sourceRef: string | null;
    author: Author;
  }[];
  events: Event[];
};

type EdgeExportRow = {
  verb: string;
  props: Record<string, unknown>;
  confidence: number | null;
  occurred_at: Date | null;
  source: string;
  source_ref: string | null;
  author: string;
  from_source: string;
  from_ref: string;
  to_source: string;
  to_ref: string;
};

export async function exportBrain(q: Query): Promise<Snapshot> {
  const { kinds, verbs } = await catalog(q);
  // Live records and the aliases merged into them; plainly deleted ones stay out.
  const records = await q.query<
    RecordRow & { into_source: string | null; into_ref: string | null }
  >(
    `select ${recordColumns
      .split(", ")
      .map((c) => `r.${c}`)
      .join(", ")},
            w.source as into_source, w.source_ref as into_ref
     from records r left join records w on w.id = r.merged_into
     where r.deleted_at is null or r.merged_into is not null
     order by r.created_at, r.id`,
  );
  const edges = await q.query<EdgeExportRow>(
    `select e.verb, e.props, e.confidence, e.occurred_at, e.source,
            e.source_ref, e.author,
            f.source as from_source, f.source_ref as from_ref,
            t.source as to_source, t.source_ref as to_ref
     from edges e
     join records f on f.id = e.from_id
     join records t on t.id = e.to_id
     where (f.deleted_at is null or f.merged_into is not null)
       and (t.deleted_at is null or t.merged_into is not null)
     order by e.created_at, e.id`,
  );
  const events = await q.query<EventRow>(
    `select ${eventColumns} from events order by seq`,
  );
  const strip = ({ name, description, author }: (typeof verbs)[number]) => ({
    name,
    description,
    author,
  });
  return {
    format: "maslow-brain/1",
    exportedAt: new Date().toISOString(),
    kinds: kinds.map(strip),
    properties: kinds.flatMap((k) =>
      k.properties.map((p) => ({
        kind: k.name,
        name: p.name,
        type: p.type,
        description: p.description,
        required: p.required,
        options: p.options,
        author: p.author,
      })),
    ),
    verbs: verbs.map(strip),
    records: records.rows.map((r) => ({
      kind: r.kind,
      layer: r.layer,
      source: r.source,
      sourceRef: r.source_ref,
      title: r.title,
      body: r.body,
      props: r.props,
      occurredAt: r.occurred_at?.toISOString() ?? null,
      confidence: r.confidence,
      author: r.author,
      mergedInto: r.into_source
        ? { source: r.into_source, sourceRef: r.into_ref! }
        : null,
    })),
    edges: edges.rows.map((e) => ({
      from: { source: e.from_source, sourceRef: e.from_ref },
      verb: e.verb,
      to: { source: e.to_source, sourceRef: e.to_ref },
      props: e.props,
      confidence: e.confidence,
      occurredAt: e.occurred_at?.toISOString() ?? null,
      source: e.source,
      sourceRef: e.source_ref,
      author: e.author,
    })),
    events: events.rows.map(toEvent),
  };
}

export type Imported = {
  kinds: number;
  properties: number;
  verbs: number;
  records: number;
  edges: number;
  merges: number;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown) => typeof v === "string";
const isTime = (v: unknown) =>
  v === null || (isText(v) && !Number.isNaN(Date.parse(v)));
const isConfidence = (v: unknown) =>
  v === null || (typeof v === "number" && v >= 0 && v <= 1);
const isRef = (v: unknown) =>
  isObject(v) && isText(v.source) && isText(v.sourceRef);
const isNamed = (v: unknown) =>
  isObject(v) && isText(v.name) && isText(v.description);
const TYPES = new Set<string>([
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "list",
]);
const isProperty = (v: unknown) =>
  isObject(v) &&
  isText(v.kind) &&
  isText(v.name) &&
  isText(v.type) &&
  TYPES.has(v.type) &&
  isText(v.description) &&
  typeof v.required === "boolean" &&
  (v.options === null || (Array.isArray(v.options) && v.options.every(isText)));
const isRecordEntry = (v: unknown) =>
  isObject(v) &&
  isRef(v) &&
  isText(v.kind) &&
  (v.layer === "source" || v.layer === "derived") &&
  isText(v.title) &&
  isText(v.body) &&
  isObject(v.props) &&
  isTime(v.occurredAt) &&
  isConfidence(v.confidence) &&
  (v.layer === "derived" || v.confidence === null) &&
  (v.mergedInto === null || isRef(v.mergedInto));
const isEdgeEntry = (v: unknown) =>
  isObject(v) &&
  isRef(v.from) &&
  isRef(v.to) &&
  isText(v.verb) &&
  isText(v.source) &&
  (v.sourceRef === null || isText(v.sourceRef)) &&
  isObject(v.props) &&
  isConfidence(v.confidence) &&
  isTime(v.occurredAt);

// Whether a parsed file is a brain snapshot this version can import, down to
// each entry, so nothing malformed reaches a transaction.
export function isSnapshot(file: unknown): file is Snapshot {
  if (!isObject(file) || file.format !== "maslow-brain/1") return false;
  const every = (v: unknown, ok: (x: unknown) => boolean) =>
    Array.isArray(v) && v.every(ok);
  return (
    every(file.kinds, isNamed) &&
    every(file.verbs, isNamed) &&
    every(file.properties ?? [], isProperty) &&
    every(file.records, isRecordEntry) &&
    every(file.edges, isEdgeEntry)
  );
}

// Adds a snapshot to this brain through the same doors any write uses, as
// the person importing it, and counts what was new or changed. The file's
// authors and events describe the brain it came from; this brain logs its own.
export async function importBrain(
  q: Query,
  author: Author,
  snapshot: unknown,
): Promise<Imported> {
  if (!isSnapshot(snapshot)) throw new Invalid("that is not a brain file");
  const count = (c: Awaited<ReturnType<typeof catalog>>) => ({
    kinds: c.kinds.length,
    properties: c.kinds.reduce((n, k) => n + k.properties.length, 0),
    verbs: c.verbs.length,
  });
  const before = count(await catalog(q));
  for (const k of snapshot.kinds) await defineKind(q, author, k);
  for (const p of snapshot.properties ?? []) {
    await defineProperty(q, author, p.kind, {
      ...p,
      options: p.options ?? undefined,
    });
  }
  for (const v of snapshot.verbs) await defineVerb(q, author, v);
  const after = count(await catalog(q));
  let records = 0;
  for (const r of snapshot.records) {
    records += (await write(q, author, { records: [r] })).changed;
  }
  let edges = 0;
  for (const e of snapshot.edges) {
    edges += (await write(q, author, { edges: [e] })).edges;
  }
  let merges = 0;
  const byRef = async (ref: { source: string; sourceRef: string }) =>
    (
      await q.query<{ id: string; merged_into: string | null }>(
        "select id, merged_into from records where source = $1 and source_ref = $2",
        [ref.source, ref.sourceRef],
      )
    ).rows[0];
  for (const r of snapshot.records) {
    if (!r.mergedInto) continue;
    const loser = await byRef(r);
    const winner = await byRef(r.mergedInto);
    if (!loser || !winner || loser.merged_into === winner.id) continue;
    await merge(q, author, winner.id, loser.id);
    merges += 1;
  }
  return {
    kinds: after.kinds - before.kinds,
    properties: after.properties - before.properties,
    verbs: after.verbs - before.verbs,
    records,
    edges,
    merges,
  };
}
