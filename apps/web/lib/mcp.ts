import * as brain from "@placeholder/brain";
import { asPerson, Gone } from "@placeholder/db";
import type { Session } from "@placeholder/db/auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// What an agent is told when it connects.
const INSTRUCTIONS = `This is one person's brain: a graph of what they know as records, the links between them, and a log of every change. It is a mind, not a mirror: write what you concluded, with a confidence and an edge back to a stub of what it rests on (the app, its own id, and enough to cite it), never a copy of a mailbox or a calendar.

Kinds and verbs are this person's own vocabulary, and it starts empty. Read the catalog before writing; reuse a name before defining one; a record of an undefined kind is refused. Define a kind or verb in the same write call, with a one-sentence description. A kind may declare fields; values then live in props and must fit. The catalog also lists kinds colleagues have shared into this brain, each with its owner and how it reached here; those are read with the owner named, and never written to.

Writes are idempotent on a record's source and sourceRef: write the same thing twice and nothing changes. Edit from the version you read. Every record carries where it came from, so cite it.`;

const ref = z.union([
  z.object({ id: z.string() }),
  z.object({ source: z.string(), sourceRef: z.string() }),
]);
const propertyType = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "list",
]);
const property = z.object({
  name: z.string().describe("lowercase letters, digits and underscores"),
  type: propertyType,
  description: z.string(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional().describe("the values, for enum"),
});
const definition = z.object({
  name: z.string(),
  description: z.string().describe("one sentence saying what it is"),
});
const kind = definition.extend({ properties: z.array(property).optional() });
const props = z.record(z.string(), z.unknown());
// A moment, checked here so a malformed one is a refusal and never a
// database error.
const moment = z.iso
  .datetime({ offset: true })
  .describe("ISO 8601 with a zone, like 2026-09-05T14:30:00Z");
const instant = moment.nullable();
const confidence = z.number().min(0).max(1).nullable();
const record = z.object({
  kind: z.string(),
  layer: z
    .enum(["source", "derived"])
    .describe("source: a stub of something outside; derived: a conclusion"),
  source: z.string().describe("the app or origin, like gmail or person"),
  sourceRef: z.string().describe("its id there; unique with source"),
  title: z.string().optional(),
  body: z.string().optional().describe("markdown"),
  props: props.optional(),
  occurredAt: instant.optional(),
  confidence: confidence.optional(),
});
const edge = z.object({
  from: ref,
  verb: z.string(),
  to: ref,
  props: props.optional(),
  confidence: confidence.optional(),
  occurredAt: instant.optional(),
  source: z.string(),
  sourceRef: z.string().nullable().optional(),
});
const filter = z.object({
  property: z.string(),
  op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in", "contains"]),
  value: z.unknown(),
});
const id = z.string().regex(brain.ID).describe("ten characters");

type Result = { content: { type: "text"; text: string }[]; isError?: true };

const said = (v: unknown): Result => ({
  content: [{ type: "text", text: JSON.stringify(v, null, 2) }],
});

const REFUSALS = [
  brain.Invalid,
  brain.NotFound,
  brain.Conflict,
  brain.Forbidden,
  Gone,
];

// The brain as an MCP server for one session: each tool is one door, opened
// in one transaction as the person, and a refusal is handed back as a
// sentence for the agent to act on.
export function brainServer(s: Session): McpServer {
  const server = new McpServer(
    { name: "brain", version: "1" },
    { instructions: INSTRUCTIONS },
  );
  const author = s.client ? `model:${s.client}` : `person:${s.userId}`;
  const door =
    <A>(fn: (q: brain.Query, args: A) => Promise<unknown>) =>
    async (args: A): Promise<Result> => {
      try {
        return said(await asPerson(s, (q) => fn(q, args)));
      } catch (err) {
        if (REFUSALS.some((R) => err instanceof R))
          return {
            isError: true,
            content: [{ type: "text", text: (err as Error).message }],
          };
        throw err;
      }
    };
  const date = (s: string | undefined) => (s ? new Date(s) : undefined);

  server.registerTool(
    "catalog",
    {
      description:
        "The person's vocabulary: every kind they defined with the fields it declares, and every verb an edge can carry, plus kinds colleagues shared into this brain (via says whether the whole kind or some records, to everyone or to them; ownerId says whose). Read before writing; reuse before defining; write only to your own kinds.",
      annotations: { readOnlyHint: true },
    },
    door((q) => brain.catalog(q)),
  );

  server.registerTool(
    "read",
    {
      description:
        "Records, newest first by when they happened. Filter by kind, layer, source, time, a person record they link to, and full-text query (words, quoted phrases, -exclusions). A kind is one person's: the caller's own, or with owner, one shared into this brain. where and orderBy work on a kind's declared fields and need a kind. Pages by cursor.",
      inputSchema: {
        scope: z
          .enum(["mine", "shared", "all"])
          .optional()
          .describe(
            "with no kind: the person's own records, what others shared, or both",
          ),
        kind: z.string().optional(),
        owner: z
          .string()
          .uuid()
          .optional()
          .describe("with kind: the member whose kind it is, from the catalog"),
        layer: z.enum(["source", "derived"]).optional(),
        source: z.string().optional(),
        person: id.optional().describe("a person record's id"),
        since: moment.optional(),
        until: moment.optional(),
        query: z.string().optional(),
        where: z.array(filter).optional(),
        orderBy: z
          .object({
            property: z.string(),
            direction: z.enum(["asc", "desc"]).optional(),
          })
          .optional(),
        includeDeleted: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    door((q, a) =>
      brain.read(q, {
        ...a,
        since: date(a.since),
        until: date(a.until),
        where: a.where as brain.Filter[] | undefined,
      }),
    ),
  );

  server.registerTool(
    "get",
    {
      description:
        "Records by id, each with every edge touching it. Missing ids are simply absent.",
      inputSchema: { ids: z.array(id).min(1).max(50) },
      annotations: { readOnlyHint: true },
    },
    door(async (q, a) => {
      const records = await brain.get(q, a.ids);
      return Promise.all(
        records.map(async (r) => ({
          ...r,
          edges: await brain.edgesOf(q, r.id),
        })),
      );
    }),
  );

  server.registerTool(
    "graph",
    {
      description:
        "The brain as a graph: live records as nodes and the edges between them. Given ids to look around, only those, their neighbours, and the edges among them.",
      inputSchema: { around: z.array(id).optional() },
      annotations: { readOnlyHint: true },
    },
    door((q, a) => brain.graph(q, a.around)),
  );

  server.registerTool(
    "write",
    {
      description:
        "Writes records and edges, defining any kinds and verbs the brain lacks in the same call. Idempotent: the same input twice changes nothing. A record must fit its kind's declared fields. Edges may name records by id or by source and sourceRef, including ones written in this call. Returns the records' ids in order.",
      inputSchema: {
        kinds: z.array(kind).optional(),
        verbs: z.array(definition).optional(),
        records: z.array(record).optional(),
        edges: z.array(edge).optional(),
      },
      annotations: { idempotentHint: true },
    },
    door((q, a) => brain.write(q, author, a)),
  );

  server.registerTool(
    "edit",
    {
      description:
        "Changes a record from the version you read; a stale version is refused, so read again and decide. New props replace the old and must fit the kind's fields. occurredAt null takes the time away.",
      inputSchema: {
        id,
        version: z.number().int(),
        kind: z.string().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        props: props.optional(),
        occurredAt: instant.optional(),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    door((q, { id, version, ...patch }) =>
      brain.edit(q, author, id, version, patch),
    ),
  );

  server.registerTool(
    "remove",
    {
      description:
        "Hides a record. Its row and history stay; restore brings it back.",
      inputSchema: { id },
      annotations: { destructiveHint: true },
    },
    door(async (q, a) => {
      await brain.remove(q, author, a.id);
      return { removed: a.id };
    }),
  );

  server.registerTool(
    "restore",
    {
      description: "Brings a removed record back.",
      inputSchema: { id },
    },
    door(async (q, a) => {
      await brain.restore(q, author, a.id);
      return { restored: a.id };
    }),
  );

  server.registerTool(
    "unlink",
    {
      description: "Removes an edge by id. The log keeps what it said.",
      inputSchema: { id },
      annotations: { destructiveHint: true },
    },
    door(async (q, a) => {
      await brain.unlink(q, author, a.id);
      return { unlinked: a.id };
    }),
  );

  server.registerTool(
    "merge",
    {
      description:
        "Makes one record stand for another of the same kind: the loser is hidden behind a pointer to the winner and its edges show on the winner. Reversible with unmerge.",
      inputSchema: {
        into: id.describe("the winner"),
        id: id.describe("the record that will stand aside"),
      },
    },
    door((q, a) => brain.merge(q, author, a.into, a.id)),
  );

  server.registerTool(
    "unmerge",
    {
      description: "Undoes a merge: the record comes back as itself.",
      inputSchema: { id },
    },
    door(async (q, a) => {
      await brain.unmerge(q, author, a.id);
      return { unmerged: a.id };
    }),
  );

  server.registerTool(
    "history",
    {
      description:
        "The log of changes, newest first: what changed, by whom, with before and after. Optionally only one record, edge, kind, verb or field's; page with before.",
      inputSchema: {
        of: z
          .string()
          .optional()
          .describe("a record, edge, kind, verb or field id"),
        before: z.number().int().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    door((q, a) => brain.history(q, a)),
  );

  return server;
}
