import type { BrainRecord, Edge, Event, Property, Verb } from "./types.ts";

// Database rows and how they become the brain's types.

export const recordColumns =
  "id, kind, layer, source, source_ref, title, body, props, occurred_at, " +
  "confidence, author, version, created_at, updated_at, deleted_at, " +
  "merged_into, person_id";

// The columns and what the reader may do, for any select of records.
export const recordSelect = `${recordColumns}, access_level(id) as access`;

export type RecordRow = {
  id: string;
  kind: string;
  layer: "source" | "derived";
  source: string;
  source_ref: string;
  title: string;
  body: string;
  props: Record<string, unknown>;
  occurred_at: Date | null;
  confidence: number | null;
  author: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  merged_into: string | null;
  person_id: string;
  access: BrainRecord["access"];
};

export const toRecord = (r: RecordRow): BrainRecord => ({
  id: r.id,
  kind: r.kind,
  layer: r.layer,
  source: r.source,
  sourceRef: r.source_ref,
  title: r.title,
  body: r.body,
  props: r.props,
  occurredAt: r.occurred_at,
  confidence: r.confidence,
  author: r.author,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  mergedInto: r.merged_into,
  ownerId: r.person_id,
  access: r.access,
});

export const verbColumns =
  "id, name, description, author, created_at, person_id";

export type VerbRow = {
  id: string;
  name: string;
  description: string;
  author: string;
  created_at: Date;
  person_id: string;
};

export const toVerb = (v: VerbRow): Verb => ({
  id: v.id,
  name: v.name,
  description: v.description,
  author: v.author,
  createdAt: v.created_at,
  ownerId: v.person_id,
});

export const propertyColumns =
  "id, kind, name, type, description, required, options, author, " +
  "created_at, person_id";

export type PropertyRow = {
  id: string;
  kind: string;
  name: string;
  type: Property["type"];
  description: string;
  required: boolean;
  options: string[] | null;
  author: string;
  created_at: Date;
  person_id: string;
};

export const toProperty = (p: PropertyRow): Property => ({
  id: p.id,
  kind: p.kind,
  name: p.name,
  type: p.type,
  description: p.description,
  required: p.required,
  options: p.options,
  author: p.author,
  createdAt: p.created_at,
  ownerId: p.person_id,
});

export const edgeColumns =
  "id, from_id, verb, to_id, props, confidence, occurred_at, source, " +
  "source_ref, author, created_at";

export type EdgeRow = {
  id: string;
  from_id: string;
  verb: string;
  to_id: string;
  props: Record<string, unknown>;
  confidence: number | null;
  occurred_at: Date | null;
  source: string;
  source_ref: string | null;
  author: string;
  created_at: Date;
};

export const toEdge = (e: EdgeRow): Edge => ({
  id: e.id,
  fromId: e.from_id,
  verb: e.verb,
  toId: e.to_id,
  props: e.props,
  confidence: e.confidence,
  occurredAt: e.occurred_at,
  source: e.source,
  sourceRef: e.source_ref,
  author: e.author,
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
