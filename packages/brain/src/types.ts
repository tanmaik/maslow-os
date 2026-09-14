import type pg from "pg";

// A client inside an org-scoped transaction. The doors never open their own.
export type Query = pg.ClientBase;

// What a member may do with a record: see it, change it, or everything.
export type Access = "view" | "edit" | "owner";

// Who a share is for: one member, one group, or everyone in the org.
export type Subject =
  | { who: "everyone" }
  | { who: "group"; id: string }
  | { who: "member"; id: string };

// What a share is on: one record, or one type and so every record of it.
export type Target = { record: string } | { type: string };

// One share: a subject may do this much with one record or one type.
export type Share = {
  id: string;
  on: Target;
  subject: Subject;
  level: Access;
};

export type Datatype =
  "text" | "number" | "boolean" | "date" | "datetime" | "enum" | "list";

// One field on a type's form. Values live in a record's props under name.
export type Property = {
  id: string;
  type: string;
  name: string;
  datatype: Datatype;
  required: boolean;
  options: string[] | null;
  ownerId: string;
};

// One member of the org, as the agent may name them when it asks to share.
export type Person = { id: string; name: string; email: string };

// One type a record can be, with the fields it declares: the reader's own,
// or a colleague's shared into this brain.
export type BrainType = {
  id: string;
  name: string;
  properties: Property[];
  own: boolean;
  ownerId: string;
};

// One thing the brain knows, with where it came from: the app and its own
// id there, or the brain itself and a fresh id when it was written here.
export type BrainRecord = {
  id: string;
  type: string;
  source: string;
  sourceRef: string;
  title: string;
  body: string;
  props: Record<string, unknown>;
  occurredAt: Date | null;
  // How sure the writer was; set when the record is a conclusion.
  confidence: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  // Set when this record was merged into another and now stands aside for it.
  mergedInto: string | null;
  // The membership that wrote it, and what the reader may do with it.
  ownerId: string;
  access: Access;
};

// A record as a list, a link or a picker shows it: everything but the body.
// The body is declared as null rather than left out, so a stub cannot be
// handed to the write door: RecordInput takes a string body, and passing one
// of these would blank a body that was never read.
export type Stub = Omit<BrainRecord, "body"> & { body?: null };

// One directed link between two records: what, how strongly, since when.
export type Edge = {
  id: string;
  fromId: string;
  verb: string;
  toId: string;
  confidence: number | null;
  occurredAt: Date | null;
  createdAt: Date;
};

// One line of the log: its place in the whole log, its number among its
// person's changes, and what changed.
export type Event = {
  seq: number;
  n: number;
  at: Date;
  subject:
    | "record"
    | "edge"
    | "type"
    | "verb"
    | "property"
    | "share"
    | "request"
    | "member";
  subjectId: string;
  action: "created" | "updated" | "deleted";
  // Who made the change: "seed", "person:<id>" or "model:<app>".
  author: string;
  before: unknown;
  after: unknown;
};

// Names a record by id, by where it came from, or by its position among
// the records written in the same call.
export type Ref =
  { id: string } | { source: string; sourceRef: string } | { index: number };

export type RecordInput = {
  type: string;
  // Where it came from, when it came from somewhere: the same pair written
  // twice is one record.
  source?: string;
  sourceRef?: string;
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
  confidence?: number | null;
  occurredAt?: Date | string | null;
};

// A condition on a declared field. `in` takes a list of values; `contains`
// looks for one value in a list field or a run of characters in a text one;
// `unset` is a field with no value, and takes none.
export type Filter = {
  property: string;
  op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "contains" | "unset";
  value?: unknown;
};

// What to order by: a declared field, or, with no field named, when the
// record happened.
export type Sort = { property?: string; direction?: "asc" | "desc" };
