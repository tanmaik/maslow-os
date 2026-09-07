import { catalog, defineType } from "./catalog.ts";
import { Invalid } from "./errors.ts";
import { defineProperty } from "./properties.ts";
import {
  eventColumns,
  recordColumns,
  toEvent,
  type EventRow,
  type RecordRow,
} from "./rows.ts";
import { share, sharesOf } from "./share.ts";
import type { Access, Datatype, Event, Query, Subject } from "./types.ts";
import { merge, write } from "./write.ts";

// One person's brain as a file: their vocabulary, every live record and edge
// of their own, the shares on them, and their log. Edges name their ends by
// source and ref, never by id; shares name a record the same way, a type by
// name, people by email and groups by name, so the file imports into any
// brain. What colleagues shared into this brain stays out: it is theirs.
export type Snapshot = {
  format: "maslow-brain/1";
  exportedAt: string;
  types: { name: string }[];
  properties: {
    type: string;
    name: string;
    datatype: Datatype;
    required: boolean;
    options: string[] | null;
  }[];
  records: {
    type: string;
    source: string;
    sourceRef: string;
    title: string;
    body: string;
    props: Record<string, unknown>;
    occurredAt: string | null;
    confidence: number | null;
    // Set when this record was merged into the one named.
    mergedInto: { source: string; sourceRef: string } | null;
  }[];
  edges: {
    from: { source: string; sourceRef: string };
    verb: string;
    to: { source: string; sourceRef: string };
    confidence: number | null;
    occurredAt: string | null;
  }[];
  shares: {
    on: { source: string; sourceRef: string } | { type: string };
    subject: "everyone" | { group: string } | { member: string };
    level: Access;
  }[];
  events: Event[];
};

type ShareExportRow = {
  source: string | null;
  source_ref: string | null;
  type: string | null;
  subject: "everyone" | "group" | "member";
  level: Access;
  group_name: string | null;
  member_email: string | null;
};

type EdgeExportRow = {
  verb: string;
  confidence: number | null;
  occurred_at: Date | null;
  from_source: string;
  from_ref: string;
  to_source: string;
  to_ref: string;
};

export async function exportBrain(q: Query): Promise<Snapshot> {
  const vocabulary = await catalog(q);
  const types = vocabulary.types.filter((t) => t.own);
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
     where r.person_id = current_member()
       and (r.deleted_at is null or r.merged_into is not null)
     order by r.created_at, r.id`,
  );
  const edges = await q.query<EdgeExportRow>(
    `select e.verb, e.confidence, e.occurred_at,
            f.source as from_source, f.source_ref as from_ref,
            t.source as to_source, t.source_ref as to_ref
     from edges e
     join records f on f.id = e.from_id
     join records t on t.id = e.to_id
     where f.person_id = current_member() and t.person_id = current_member()
       and e.deleted_at is null
       and (f.deleted_at is null or f.merged_into is not null)
       and (t.deleted_at is null or t.merged_into is not null)
     order by e.created_at, e.id`,
  );
  const shares = await q.query<ShareExportRow>(
    `select r.source, r.source_ref, t.name as type, s.subject, s.level,
            gr.name as group_name, u.email as member_email
     from shares s
     left join records r on r.id = s.record_id
     left join types t on t.id = s.type_id
     left join groups gr on gr.id = s.group_id
     left join users u on u.id = s.member_id
     where coalesce(r.person_id, t.person_id) = current_member()
       and (s.record_id is null or r.deleted_at is null)
     order by s.id`,
  );
  const events = await q.query<EventRow>(
    `select ${eventColumns} from events
     where person_id = current_member() order by seq`,
  );
  return {
    format: "maslow-brain/1",
    exportedAt: new Date().toISOString(),
    types: types.map(({ name }) => ({ name })),
    properties: types.flatMap((t) =>
      t.properties.map((p) => ({
        type: t.name,
        name: p.name,
        datatype: p.datatype,
        required: p.required,
        options: p.options,
      })),
    ),
    records: records.rows.map((r) => ({
      type: r.type,
      source: r.source,
      sourceRef: r.source_ref,
      title: r.title,
      body: r.body,
      props: r.props,
      occurredAt: r.occurred_at?.toISOString() ?? null,
      confidence: r.confidence,
      mergedInto: r.into_source
        ? { source: r.into_source, sourceRef: r.into_ref! }
        : null,
    })),
    edges: edges.rows.map((e) => ({
      from: { source: e.from_source, sourceRef: e.from_ref },
      verb: e.verb,
      to: { source: e.to_source, sourceRef: e.to_ref },
      confidence: e.confidence,
      occurredAt: e.occurred_at?.toISOString() ?? null,
    })),
    shares: shares.rows.flatMap((s) => {
      const subject =
        s.subject === "everyone"
          ? "everyone"
          : s.subject === "group" && s.group_name
            ? { group: s.group_name }
            : s.subject === "member" && s.member_email
              ? { member: s.member_email }
              : null;
      return subject
        ? [
            {
              on: s.type
                ? { type: s.type }
                : { source: s.source!, sourceRef: s.source_ref! },
              subject,
              level: s.level,
            },
          ]
        : [];
    }),
    events: events.rows.map(toEvent),
  };
}

export type Imported = {
  types: number;
  properties: number;
  records: number;
  edges: number;
  merges: number;
  shares: number;
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
const isNamed = (v: unknown) => isObject(v) && isText(v.name);
const DATATYPES = new Set<string>([
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
  isText(v.type) &&
  isText(v.name) &&
  isText(v.datatype) &&
  DATATYPES.has(v.datatype) &&
  typeof v.required === "boolean" &&
  (v.options === null || (Array.isArray(v.options) && v.options.every(isText)));
const isRecordEntry = (v: unknown) =>
  isObject(v) &&
  isRef(v) &&
  isText(v.type) &&
  isText(v.title) &&
  isText(v.body) &&
  isObject(v.props) &&
  isTime(v.occurredAt) &&
  isConfidence(v.confidence) &&
  (v.mergedInto === null || isRef(v.mergedInto));
const LEVELS = new Set<string>(["view", "edit", "owner"]);
const isShareEntry = (v: unknown) =>
  isObject(v) &&
  isObject(v.on) &&
  (isRef(v.on) || isText(v.on.type)) &&
  (v.subject === "everyone" ||
    (isObject(v.subject) &&
      Object.keys(v.subject).length === 1 &&
      (isText(v.subject.group) || isText(v.subject.member)))) &&
  isText(v.level) &&
  LEVELS.has(v.level) &&
  (v.subject !== "everyone" || v.level === "view");
const isEdgeEntry = (v: unknown) =>
  isObject(v) &&
  isRef(v.from) &&
  isRef(v.to) &&
  isText(v.verb) &&
  isConfidence(v.confidence) &&
  isTime(v.occurredAt);

// Whether a parsed file is a brain snapshot this version can import, down to
// each entry, so nothing malformed reaches a transaction.
function isSnapshot(file: unknown): file is Snapshot {
  if (!isObject(file) || file.format !== "maslow-brain/1") return false;
  const every = (v: unknown, ok: (x: unknown) => boolean) =>
    Array.isArray(v) && v.every(ok);
  return (
    every(file.types, isNamed) &&
    every(file.properties, isProperty) &&
    every(file.records, isRecordEntry) &&
    every(file.edges, isEdgeEntry) &&
    every(file.shares, isShareEntry)
  );
}

// Adds a snapshot to this brain through the same doors any write uses, as
// the person importing it, and counts what was new or changed. The file's
// events describe the brain it came from; this brain logs its own.
export async function importBrain(
  q: Query,
  snapshot: unknown,
): Promise<Imported> {
  if (!isSnapshot(snapshot)) throw new Invalid("that is not a brain file");
  const count = (c: Awaited<ReturnType<typeof catalog>>) => {
    const mine = c.types.filter((t) => t.own);
    return {
      types: mine.length,
      properties: mine.reduce((n, t) => n + t.properties.length, 0),
    };
  };
  const before = count(await catalog(q));
  for (const t of snapshot.types) await defineType(q, t);
  for (const p of snapshot.properties) {
    await defineProperty(q, p.type, { ...p, options: p.options ?? undefined });
  }
  const after = count(await catalog(q));
  let records = 0;
  for (const r of snapshot.records) {
    records += (await write(q, { records: [r] })).changed;
  }
  let edges = 0;
  for (const e of snapshot.edges) {
    edges += (await write(q, { edges: [e] })).edges;
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
    await merge(q, winner.id, loser.id);
    merges += 1;
  }
  // A share lands where its record or type, its group or its person is here.
  const ownType = async (name: string) =>
    (
      await q.query<{ id: string }>(
        "select id from types where name = $1 and person_id = current_member()",
        [name],
      )
    ).rows[0];
  let shares = 0;
  for (const s of snapshot.shares) {
    const target =
      "type" in s.on ? await ownType(s.on.type) : await byRef(s.on);
    if (!target) continue;
    const on = "type" in s.on ? { type: target.id } : { record: target.id };
    let subject: Subject | null = null;
    if (s.subject === "everyone") subject = { who: "everyone" };
    else if ("group" in s.subject) {
      const found = await q.query<{ id: string }>(
        "select id from groups where name = $1",
        [s.subject.group],
      );
      if (found.rows[0]) subject = { who: "group", id: found.rows[0].id };
    } else {
      const found = await q.query<{ id: string }>(
        "select id from users where email = $1",
        [s.subject.member],
      );
      if (found.rows[0]) subject = { who: "member", id: found.rows[0].id };
    }
    if (!subject) continue;
    const had = (await sharesOf(q, on)).some(
      (x) =>
        x.level === s.level &&
        x.subject.who === subject.who &&
        ("id" in x.subject ? x.subject.id : null) ===
          ("id" in subject ? subject.id : null),
    );
    await share(q, on, subject, s.level);
    if (!had) shares += 1;
  }
  return {
    types: after.types - before.types,
    properties: after.properties - before.properties,
    records,
    edges,
    merges,
    shares,
  };
}
