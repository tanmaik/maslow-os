import type pg from "pg";

// A client inside an org-scoped transaction. The doors never open their own.
export type Query = pg.ClientBase;

// Who made a write: "seed", "person:<id>", "job:<kind>:<id>", "model:<call>".
export type Author = string;

export type Layer = "source" | "derived";

// What a member may do with a record: see it, change it, or everything.
export type Access = "view" | "edit" | "owner";

// Who a grant is for: one member, one group, or everyone in the org.
export type Subject =
  | { kind: "everyone" }
  | { kind: "group"; id: string }
  | { kind: "member"; id: string };

// What a grant is on: one record, or one kind and so every record of it.
export type Target = { record: string } | { kind: string };

// One share: a subject may do this much with one record or one kind.
export type Grant = {
  id: string;
  on: Target;
  subject: Subject;
  level: Access;
  author: Author;
  createdAt: Date;
};

// How a kind that is not the reader's own reaches them: through a grant on
// the whole kind or on some of its records, to everyone in the org or to
// them in particular.
export type Via = { whole: boolean; everyone: boolean };

// One verb an edge can carry, in the vocabulary of the member who owns it.
export type Verb = {
  id: string;
  name: string;
  description: string;
  author: Author;
  createdAt: Date;
  ownerId: string;
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
  ownerId: string;
};

// One kind a record can be, with the fields it declares. Via is set when
// the kind is someone else's, shared into this brain.
export type Kind = Verb & { properties: Property[]; via: Via | null };

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
  // The membership that wrote it, and what the reader may do with it.
  ownerId: string;
  access: Access;
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
