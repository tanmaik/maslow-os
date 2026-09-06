import * as brain from "@placeholder/brain";
import { asPerson, Gone, type Query } from "@placeholder/db";
import { fullName, type Session } from "@placeholder/db/auth";
import { spend } from "@placeholder/db/usage";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { embed, model } from "./embeddings";
import * as lines from "./lines";
import { PRICES } from "./prices";

// Who and what an agent is connected to, read once when it connects.
export type About = {
  person: string;
  org: string;
  kinds: { name: string; records: number }[];
  shared: number;
  verbs: string[];
};

export async function about(q: brain.Query, s: Session): Promise<About> {
  const { rows } = await q.query<{
    firstName: string;
    lastName: string | null;
    org: string;
    kinds: About["kinds"];
    shared: number;
    verbs: string[];
  }>(
    `select u.first_name as "firstName", u.last_name as "lastName",
         (select name from orgs) as org,
         (select coalesce(json_agg(json_build_object('name', k.name, 'records', k.records)
             order by k.records desc, k.name), '[]')
          from (select k.name, count(r.id)::int as records
                from record_kinds k
                left join records r on r.kind = k.name
                  and r.person_id = k.person_id
                  and r.deleted_at is null and r.merged_into is null
                where k.person_id = current_member()
                group by k.name) k) as kinds,
         (select count(*)::int from record_kinds
          where person_id <> current_member()) as shared,
         (select coalesce(array_agg(name order by name), '{}') from edge_verbs)
           as verbs
       from users u where u.id = $1`,
    [s.userId],
  );
  const me = rows[0]!;
  return {
    person: fullName(me),
    org: me.org,
    kinds: me.kinds,
    shared: me.shared,
    verbs: me.verbs,
  };
}

// What an agent is told when it connects: whose brain, what is in it, and
// how to treat it.
function instructions(a: About | null, client: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  const held = a
    ? a.kinds.length === 0 && a.verbs.length === 0
      ? "Their vocabulary is empty: no kinds, no verbs, no records yet."
      : `It holds ${a.kinds.reduce((n, k) => n + k.records, 0)} records: ${a.kinds
          .map((k) => `${k.records} ${k.name}`)
          .join(", ")}. Verbs: ${a.verbs.join(", ") || "none"}.${
          a.shared ? ` ${a.shared} kinds are shared in by colleagues.` : ""
        }`
    : "";
  const whose = a
    ? `This is ${lines.flat(a.person)}'s brain in ${lines.flat(a.org)}, and you are connected to it as ${lines.flat(client ?? "an app")}. Today is ${today}. ${held}`
    : `This is one person's brain. Today is ${today}.`;
  return `${whose}

A brain is a graph of what a person knows: records, the links between them, and a log of every change. It is a mind, not a mirror: write what you concluded, with a confidence and an edge back to a stub of what it rests on (the app, its own id, and enough to cite it), never a copy of a mailbox or a calendar.

Kinds and verbs are this person's own vocabulary, and it starts empty. Reuse a name before defining one; a record of an undefined kind is refused. Define a kind or verb in the same write call, with a one-sentence description. A kind may declare fields; values then live in props and must fit. Reshape it later with redefine and undefine. The catalog also lists kinds colleagues shared into this brain, each with its owner: read those with owner named, never write to them.

Writes are idempotent on a record's source and sourceRef. Edit from the version you read. Ids are ten characters; carry them exactly.

Answers are lines, not JSON. A record: id kind when "title" src=source:ref vN by=who, then edited=when once changed, derived c=confidence, shared:level, removed or merged→id when so, then its props as JSON; its body sits beneath, indented. by=you is the person's own words; by=colleague is theirs; any other name is an app's, so weigh it as a conclusion. A link from a record: → verb id "title" or ← for one made to it. A change in the log: #seq when subject id action by=who: field before→after.`;
}

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
const fieldName = z
  .string()
  .describe("lowercase letters, digits and underscores");
const property = z.object({
  name: fieldName,
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
  title: z.string().max(500).optional(),
  body: z.string().max(100_000).optional().describe("markdown"),
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
const ids = z.array(id).min(1).max(50);
// A change to a record: what a record has, minus where it came from, all
// optional; the version it was read at; a confidence that stays.
const change = record
  .omit({ layer: true, source: true, sourceRef: true })
  .partial()
  .extend({
    id,
    version: z.number().int(),
    confidence: z.number().min(0).max(1).optional(),
  });
const rename = definition
  .partial()
  .extend({ name: z.string(), newName: z.string().optional() });
const fieldChange = property.partial().extend({
  kind: z.string(),
  name: z.string(),
  newName: fieldName.optional(),
});
const field = z.object({ kind: z.string(), name: z.string() });

type Result = { content: { type: "text"; text: string }[]; isError?: true };

const said = (text: string): Result => ({
  content: [{ type: "text", text }],
});

const REFUSALS = [
  brain.Invalid,
  brain.NotFound,
  brain.Conflict,
  brain.Forbidden,
  Gone,
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The brain as an MCP server for one session: each tool is one door, opened
// in one transaction as the person, answered in lines, and a refusal is
// handed back as a sentence for the agent to act on.
export function brainServer(s: Session, a: About | null = null): McpServer {
  const server = new McpServer(
    { name: "brain", version: "2" },
    { instructions: instructions(a, s.client) },
  );
  const author = s.client ? `model:${s.client}` : `person:${s.userId}`;
  const refusing = async (fn: () => Promise<string>): Promise<Result> => {
    try {
      return said(await fn());
    } catch (err) {
      if (REFUSALS.some((R) => err instanceof R))
        return { isError: true, ...said((err as Error).message) };
      throw err;
    }
  };
  const door =
    <A>(fn: (q: Query, args: A) => Promise<string>) =>
    (args: A) =>
      refusing(() => asPerson(s, (q) => fn(q, args)));
  const date = (s: string | undefined) => (s ? new Date(s) : undefined);
  const line = (r: brain.BrainRecord, detail?: "brief" | "full") =>
    lines.record(r, s.userId, detail);

  server.registerTool(
    "catalog",
    {
      description:
        "The person's vocabulary: every kind they defined with its fields, every verb an edge can carry, and the kinds colleagues shared into this brain, each with its owner and how it reached here. Reuse before defining; write only to your own kinds.",
      annotations: { readOnlyHint: true },
    },
    door(async (q) => {
      const { kinds, verbs } = await brain.catalog(q);
      return lines.catalog(kinds, verbs);
    }),
  );

  server.registerTool(
    "read",
    {
      description:
        "Records, newest first by when they happened, one per line with the first line of the body beneath. Filter by kind, layer, source, time, a person record they link to, and full-text query (words, quoted phrases, -exclusions). A kind is one person's: the caller's own, or with owner, one shared into this brain. where and orderBy work on a kind's declared fields and need a kind. Pages by cursor. detail full gives whole bodies.",
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
        detail: z.enum(["brief", "full"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    door(async (q, a) => {
      const page = await brain.read(q, {
        ...a,
        since: date(a.since),
        until: date(a.until),
        where: a.where as brain.Filter[] | undefined,
      });
      if (page.records.length === 0) return "no records";
      const head = `${plural(page.records.length, "record")}${page.cursor ? `, more after cursor=${page.cursor}` : ""}`;
      return [head, ...page.records.map((r) => line(r, a.detail))].join("\n");
    }),
  );

  server.registerTool(
    "get",
    {
      description:
        "Records by id, whole, each with every link touching it and what is at the other end. Missing ids are simply absent.",
      inputSchema: { ids },
      annotations: { readOnlyHint: true },
    },
    door(async (q, a) => {
      const records = await brain.get(q, a.ids);
      if (records.length === 0) return "no records";
      const around = await Promise.all(
        records.map(async (r) => ({
          r,
          same: new Set(await brain.aliasesOf(q, r.id)),
          edges: await brain.edgesOf(q, r.id),
        })),
      );
      const titles = new Map(
        (
          await brain.get(q, [
            ...new Set(
              around.flatMap((x) => x.edges.flatMap((e) => [e.fromId, e.toId])),
            ),
          ])
        ).map((o) => [o.id, o.title]),
      );
      return around
        .flatMap(({ r, same, edges }) => [
          line(r, "full"),
          ...edges.map((e) => lines.edgeFrom(e, same, titles)),
        ])
        .join("\n");
    }),
  );

  server.registerTool(
    "graph",
    {
      description:
        "Walks the brain as a graph. Given records to start from, everything within depth links of them along the verbs named, following links out, in or both ways, then the links among what was found. With no start, the whole brain. Each record comes with its distance.",
      inputSchema: {
        from: ids.optional(),
        depth: z.number().int().min(0).max(4).optional(),
        verbs: z.array(z.string()).optional(),
        direction: z.enum(["out", "in", "both"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    door(async (q, { from, ...opts }) => {
      const g = await brain.graph(q, from, opts);
      const head = `${plural(g.nodes.length, "record")}, ${plural(g.edges.length, "edge")}`;
      const nodes = g.nodes.map(
        (n) =>
          `${n.id} ${lines.token(n.kind)} ${JSON.stringify(n.title)}${n.depth === null ? "" : ` d${n.depth}`}`,
      );
      const edges = g.edges.map(lines.edge);
      return [
        head,
        ...nodes,
        ...(edges.length ? ["edges:", ...edges] : []),
      ].join("\n");
    }),
  );

  server.registerTool(
    "write",
    {
      description:
        "Writes records and edges, defining any kinds and verbs the brain lacks in the same call. Idempotent: the same input twice changes nothing. A record must fit its kind's declared fields. Edges may name records by id or by source and sourceRef, including ones written in this call. Answers with each record's id, in order.",
      inputSchema: {
        kinds: z.array(kind).max(20).optional(),
        verbs: z.array(definition).max(20).optional(),
        records: z.array(record).max(100).optional(),
        edges: z.array(edge).max(200).optional(),
      },
      annotations: { idempotentHint: true },
    },
    door(async (q, a) => {
      const w = await brain.write(q, author, a);
      const head = `${plural(w.records.length, "record")} (${w.changed} changed), ${plural(w.edges, "edge")} changed`;
      const written = (a.records ?? []).map(
        (r, i) => `${w.records[i]} ${r.kind} src=${r.source}:${r.sourceRef}`,
      );
      return [head, ...written].join("\n");
    }),
  );

  server.registerTool(
    "edit",
    {
      description:
        "Changes records, each from the version you read; a stale version refuses the whole call, so read again and decide. New props replace the old and must fit the kind's fields. occurredAt null takes the time away. Answers with each record as it is now.",
      inputSchema: { changes: z.array(change).min(1).max(50) },
    },
    door(async (q, a) => {
      const out: string[] = [];
      for (const { id, version, ...patch } of a.changes) {
        out.push(line(await brain.edit(q, author, id, version, patch)));
      }
      return out.join("\n");
    }),
  );

  server.registerTool(
    "remove",
    {
      description:
        "Hides records. Their rows and history stay; restore brings them back.",
      inputSchema: { ids },
      annotations: { destructiveHint: true },
    },
    door(async (q, a) => {
      for (const id of a.ids) await brain.remove(q, author, id);
      return `removed ${a.ids.join(" ")}`;
    }),
  );

  server.registerTool(
    "restore",
    {
      description: "Brings removed records back.",
      inputSchema: { ids },
    },
    door(async (q, a) => {
      for (const id of a.ids) await brain.restore(q, author, id);
      return `restored ${a.ids.join(" ")}`;
    }),
  );

  server.registerTool(
    "unlink",
    {
      description: "Removes edges by id. The log keeps what they said.",
      inputSchema: { ids },
      annotations: { destructiveHint: true },
    },
    door(async (q, a) => {
      for (const id of a.ids) await brain.unlink(q, author, id);
      return `unlinked ${a.ids.join(" ")}`;
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
    door(async (q, a) => line(await brain.merge(q, author, a.into, a.id))),
  );

  server.registerTool(
    "unmerge",
    {
      description: "Undoes merges: each record comes back as itself.",
      inputSchema: { ids },
    },
    door(async (q, a) => {
      for (const id of a.ids) await brain.unmerge(q, author, id);
      return `unmerged ${a.ids.join(" ")}`;
    }),
  );

  server.registerTool(
    "history",
    {
      description:
        "The log of changes, newest first: what changed, by whom, and only the fields that moved. Optionally only one record, edge, kind, verb or field's; page with before.",
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
    door(async (q, a) => {
      const events = await brain.history(q, a);
      if (events.length === 0) return "no changes";
      const full = events.length === (a.limit ?? 50);
      const head = `${plural(events.length, "change")}${full ? `, more before=${events[events.length - 1]!.seq}` : ""}`;
      return [head, ...events.map((e) => lines.event(e, s.userId))].join("\n");
    }),
  );

  server.registerTool(
    "redefine",
    {
      description:
        "Reshapes the vocabulary: renames or redescribes kinds and verbs, and renames, retypes, redescribes or requires fields. Fields change first, then verbs, then kinds, so name a field by the kind it has now. Records and edges follow a rename. A field change must fit what records already hold, or it is refused with the count to fix first.",
      inputSchema: {
        kinds: z.array(rename).optional(),
        verbs: z.array(rename).optional(),
        fields: z.array(fieldChange).optional(),
      },
    },
    door(async (q, a) => {
      const out: string[] = [];
      // Kinds are held in name order here as a write holds them, so the
      // two never wait on each other in a circle.
      const byName = <T extends { name: string }>(a: T, b: T) =>
        a.name.localeCompare(b.name);
      const fields = [...(a.fields ?? [])].sort(
        (x, y) => x.kind.localeCompare(y.kind) || byName(x, y),
      );
      for (const { kind, name, ...c } of fields) {
        const p = await brain.redefineProperty(q, author, kind, name, c);
        out.push(`${p.kind}.${lines.field(p)}`);
      }
      for (const { name, ...c } of [...(a.verbs ?? [])].sort(byName)) {
        const v = await brain.redefine(q, author, "verb", name, c);
        out.push(`verb ${v.name} — ${v.description}`);
      }
      for (const { name, ...c } of [...(a.kinds ?? [])].sort(byName)) {
        const k = await brain.redefine(q, author, "kind", name, c);
        out.push(`kind ${k.name} — ${k.description}`);
      }
      return out.join("\n") || "nothing to change";
    }),
  );

  server.registerTool(
    "undefine",
    {
      description:
        "Takes kinds, verbs or fields out of the vocabulary. A kind with records or a verb with edges is refused; change or remove those first. Removing a field takes its values out of every record of the kind.",
      inputSchema: {
        kinds: z.array(z.string()).optional(),
        verbs: z.array(z.string()).optional(),
        fields: z.array(field).optional(),
      },
      annotations: { destructiveHint: true },
    },
    door(async (q, a) => {
      const out: string[] = [];
      for (const { kind, name } of a.fields ?? []) {
        const n = await brain.removeProperty(q, author, kind, name);
        out.push(`removed field ${kind}.${name} from ${plural(n, "record")}`);
      }
      for (const name of a.kinds ?? []) {
        await brain.undefine(q, author, "kind", name);
        out.push(`removed kind ${name}`);
      }
      for (const name of a.verbs ?? []) {
        await brain.undefine(q, author, "verb", name);
        out.push(`removed verb ${name}`);
      }
      return out.join("\n") || "nothing to remove";
    }),
  );

  // Recall exists where vectors can be made.
  const vectors = model();
  if (vectors) {
    // Every token the model counts goes on the meter, in the name of the
    // app that asked.
    const metered = async (
      q: Query,
      texts: string[],
      as: "query" | "document",
    ) => {
      const made = await embed(texts, as);
      await spend(
        q,
        s.userId,
        "vectors",
        "token",
        made.tokens,
        PRICES.vectors,
        s.client ?? "browser",
      );
      return made.vectors;
    };
    // Records changed since their vector was made are caught up first, a
    // batch at a time until none are behind, each batch in a transaction
    // of its own, so what was made stays made if the model fails midway.
    // One ask does at most fifty batches; a brain larger than that fills
    // in over a few.
    const catchUp = async () => {
      for (let batch = 0; batch < 50; batch++) {
        const caught = await asPerson(s, async (q) => {
          const behind = await brain.stale(q, vectors);
          if (behind.length === 0) return true;
          const made = await metered(
            q,
            behind.map((b) => b.text),
            "document",
          );
          await brain.remember(
            q,
            vectors,
            behind.map((b, i) => ({ ...b, embedding: made[i]! })),
          );
          return false;
        });
        if (caught) return;
      }
    };
    server.registerTool(
      "recall",
      {
        description:
          "Records nearest a question by meaning, best first with a score, across kinds. Use when you do not know the words a record uses; read with query when you do.",
        inputSchema: {
          question: z.string(),
          kind: z.string().optional(),
          since: moment.optional(),
          until: moment.optional(),
          limit: z.number().int().min(1).max(50).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      (a) =>
        refusing(async () => {
          if (!/[\p{L}\p{N}]/u.test(a.question))
            throw new brain.Invalid("a question needs a word");
          await catchUp();
          return asPerson(s, async (q) => {
            const [asked] = await metered(q, [a.question], "query");
            const found = await brain.recall(q, vectors, asked!, {
              kind: a.kind,
              since: date(a.since),
              until: date(a.until),
              limit: a.limit,
            });
            if (found.length === 0) return "no records";
            return [
              `${plural(found.length, "record")}, nearest first`,
              ...found.map((f) => `${f.score.toFixed(2)} ${line(f.record)}`),
            ].join("\n");
          });
        }),
    );
  }

  return server;
}
