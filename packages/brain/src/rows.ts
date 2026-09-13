import type { BrainRecord, Edge, Event, Property, Stub } from "./types.ts";

// Database rows and how they become the brain's types.

export const recordColumns =
  "id, type, source, source_ref, title, body, props, occurred_at, " +
  "confidence, created_at, updated_at, deleted_at, merged_into, person_id";

// The columns and what the reader may do, for any select of records.
export const recordSelect = `${recordColumns}, access_level(id) as access`;

// The same, without the body. A body is by far the largest thing a record
// holds and a list, a link or a picker renders only its title, so leaving it
// in the database is the difference between a page and a download. What comes
// back is a Stub, which the types will not let anyone save back as a record.
export const stubSelect = recordSelect.replace("body,", "'' as body,");

// How much of a body a list shows: one line under the title, and never
// more than this much of it, whatever the document behind it holds.
const OPENING = 200;

// The same again with that much of the body and no more, for a list that
// reads a line of each record. What comes back is not the record's body and
// is never written back.
export const openingSelect = recordSelect.replace(
  "body,",
  `left(body, ${OPENING}) as body,`,
);

export type RecordRow = {
  id: string;
  type: string;
  source: string;
  source_ref: string;
  title: string;
  body: string;
  props: Record<string, unknown>;
  occurred_at: Date | null;
  confidence: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  merged_into: string | null;
  person_id: string;
  access: BrainRecord["access"];
};

export const toStub = (r: RecordRow): Stub => {
  const { body: _body, ...rest } = toRecord(r);
  return rest;
};

export const toRecord = (r: RecordRow): BrainRecord => ({
  id: r.id,
  type: r.type,
  source: r.source,
  sourceRef: r.source_ref,
  title: r.title,
  body: r.body,
  props: r.props,
  occurredAt: r.occurred_at,
  confidence: r.confidence,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  mergedInto: r.merged_into,
  ownerId: r.person_id,
  access: r.access,
});

export const typeColumns = "id, name, person_id";

export type TypeRow = { id: string; name: string; person_id: string };

export const propertyColumns =
  "id, type, name, datatype, required, options, person_id";

export type PropertyRow = {
  id: string;
  type: string;
  name: string;
  datatype: Property["datatype"];
  required: boolean;
  options: string[] | null;
  person_id: string;
};

export const toProperty = (p: PropertyRow): Property => ({
  id: p.id,
  type: p.type,
  name: p.name,
  datatype: p.datatype,
  required: p.required,
  options: p.options,
  ownerId: p.person_id,
});

export const edgeColumns =
  "id, from_id, verb, to_id, confidence, occurred_at, created_at";

export type EdgeRow = {
  id: string;
  from_id: string;
  verb: string;
  to_id: string;
  confidence: number | null;
  occurred_at: Date | null;
  created_at: Date;
};

export const toEdge = (e: EdgeRow): Edge => ({
  id: e.id,
  fromId: e.from_id,
  verb: e.verb,
  toId: e.to_id,
  confidence: e.confidence,
  occurredAt: e.occurred_at,
  createdAt: e.created_at,
});

export const eventColumns =
  "seq, n, at, subject, subject_id, action, author, before, after";

export type EventRow = {
  seq: string;
  n: string;
  at: Date;
  subject: Event["subject"];
  subject_id: string;
  action: Event["action"];
  author: string;
  before: unknown;
  after: unknown;
};

export const toEvent = (e: EventRow): Event => ({
  seq: Number(e.seq),
  n: Number(e.n),
  at: e.at,
  subject: e.subject,
  subjectId: e.subject_id,
  action: e.action,
  author: e.author,
  before: e.before,
  after: e.after,
});
