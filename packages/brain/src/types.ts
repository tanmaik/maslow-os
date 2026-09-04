import type pg from "pg";

// A client inside an org-scoped transaction. The doors never open their own.
export type Query = pg.ClientBase;

// Who made a write: "seed", "person:<id>", "job:<kind>:<id>", "model:<call>".
export type Author = string;

export type Layer = "source" | "derived";

// One verb an edge can carry.
export type Verb = {
  id: string;
  name: string;
  description: string;
  author: Author;
  createdAt: Date;
};

export type PropertyType =
  "text" | "number" | "boolean" | "date" | "datetime" | "enum" | "list";

// One field on a kind's form. Values live in a record's props under name.
export type Property = {
  id: string;
  kind: string;
  name: string;
  type: PropertyType;
  description: string;
  required: boolean;
  options: string[] | null;
  author: Author;
  createdAt: Date;
};

// One kind a record can be, with the fields it declares.
export type Kind = Verb & { properties: Property[] };

// One thing the brain knows, with where it came from.
export type BrainRecord = {
  id: string;
  kind: string;
  layer: Layer;
  source: string;
  sourceRef: string;
  title: string;
  body: string;
  props: Record<string, unknown>;
  occurredAt: Date | null;
  confidence: number | null;
  author: Author;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  // Set when this record was merged into another and now stands aside for it.
  mergedInto: string | null;
};

// One directed link between two records: what, how strongly, since when.
export type Edge = {
  id: string;
  fromId: string;
  verb: string;
  toId: string;
  props: Record<string, unknown>;
  confidence: number | null;
  occurredAt: Date | null;
  source: string;
  sourceRef: string | null;
  author: Author;
  createdAt: Date;
};

// One change the database logged.
export type Event = {
  seq: number;
  at: Date;
  subject: "record" | "edge" | "kind" | "verb" | "property";
  subjectId: string;
  action: "created" | "updated" | "deleted";
  author: Author;
  before: unknown;
  after: unknown;
};

// Names a record either by id or by where it came from.
export type Ref = { id: string } | { source: string; sourceRef: string };

export type RecordInput = {
  kind: string;
  layer: Layer;
  source: string;
  sourceRef: string;
  title?: string;
  body?: string;
  props?: Record<string, unknown>;
  occurredAt?: Date | string | null;
  confidence?: number | null;
};

export type EdgeInput = {
  from: Ref;
  verb: string;
  to: Ref;
  props?: Record<string, unknown>;
  confidence?: number | null;
  occurredAt?: Date | string | null;
  source: string;
  sourceRef?: string | null;
};

// A condition on a declared field. `in` takes a list; `contains` is for lists.
export type Filter = {
  property: string;
  op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "contains";
  value: unknown;
};

export type Sort = { property: string; direction?: "asc" | "desc" };
