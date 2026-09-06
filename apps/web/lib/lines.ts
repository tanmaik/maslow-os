import type { BrainRecord, Edge, Event, Kind, Verb } from "@placeholder/brain";

// How the brain reads to an agent: one line per thing, the id first, then
// only what is there.

// An instant as 2026-09-05T14:30:00Z, with milliseconds only when it has
// them.
const when = (d: Date | null | undefined) =>
  d ? d.toISOString().replace(/\.000Z$/, "Z") : "-";

// A string cut to a length, with an ellipsis where it was cut.
export const cut = (s: string, most: number) =>
  s.length > most ? `${s.slice(0, most - 1)}…` : s;

// JSON, with the two line separators JSON leaves raw written as escapes, so
// a quoted value stays on its line.
const quoted = (v: unknown) =>
  JSON.stringify(v).replace(
    /[\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16)}`,
  );
const some = (o: Record<string, unknown>) => Object.keys(o).length > 0;

// A name as one token: bare when it is one word, quoted when a space, a
// quote, an equals sign or a bar would let it read as two.
export const token = (s: string) => (/[\s"=|]/.test(s) ? quoted(s) : s);

// A description on one line, whatever it holds.
export const flat = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ");

// A body as lines: every kind of line break made a newline and every other
// control character but tab dropped, so an indented line is always one line.
const linesOf = (body: string) =>
  body
    .replace(/\r\n?|[\p{Zl}\p{Zp}]/gu, "\n")
    .replace(/[^\P{Cc}\n\t]/gu, "")
    .trimEnd();

// Who wrote something, as the reader would say it: you, a colleague, or
// the app by name.
function by(author: string, me: string): string {
  const who =
    author === `person:${me}`
      ? "you"
      : author.startsWith("person:")
        ? "colleague"
        : author.replace(/^model:/, "");
  return /\s/.test(who) ? quoted(who) : who;
}

// One record on a line: id, kind, when, title, then its origin, version,
// author, confidence, standing and fields. Below it the body, whole or its
// first line.
export function record(
  r: BrainRecord,
  me: string,
  detail: "brief" | "full" = "brief",
): string {
  const parts = [
    r.id,
    token(r.kind),
    when(r.occurredAt ?? r.createdAt),
    quoted(r.title),
    `src=${token(r.source)}:${token(r.sourceRef)}`,
    `v${r.version}`,
    `by=${by(r.author, me)}`,
  ];
  if (r.version > 1) parts.push(`edited=${when(r.updatedAt)}`);
  if (r.layer === "derived") parts.push("derived");
  if (r.confidence !== null) parts.push(`c=${r.confidence}`);
  if (r.access !== "owner") parts.push(`shared:${r.access}`);
  if (r.mergedInto) parts.push(`merged→${r.mergedInto}`);
  else if (r.deletedAt) parts.push("removed");
  if (some(r.props)) parts.push(quoted(r.props));
  const head = parts.join(" ");
  const body = linesOf(r.body);
  if (!body.trim()) return head;
  const shown =
    detail === "full"
      ? body.replace(/^/gm, "  ")
      : `  ${cut(body.trim().split("\n")[0]!, 160)}`;
  return `${head}\n${shown}`;
}

// An edge as a sentence: from, verb, to, and what it carries.
export function edge(e: Edge): string {
  const parts = [e.id, e.fromId, token(e.verb), e.toId];
  if (e.confidence !== null) parts.push(`c=${e.confidence}`);
  if (e.occurredAt) parts.push(when(e.occurredAt));
  parts.push(
    `src=${token(e.source)}${e.sourceRef ? `:${token(e.sourceRef)}` : ""}`,
  );
  if (some(e.props)) parts.push(quoted(e.props));
  return parts.join(" ");
}

// An edge seen from one record and whatever is merged into it: which way
// it points and what is at the other end.
export function edgeFrom(
  e: Edge,
  same: Set<string>,
  titles: Map<string, string>,
): string {
  const out = same.has(e.fromId);
  const other = out ? e.toId : e.fromId;
  const parts = [
    out ? "→" : "←",
    token(e.verb),
    other,
    quoted(titles.get(other) ?? ""),
    `edge=${e.id}`,
  ];
  if (e.confidence !== null) parts.push(`c=${e.confidence}`);
  if (e.occurredAt) parts.push(when(e.occurredAt));
  if (some(e.props)) parts.push(quoted(e.props));
  return `  ${parts.join(" ")}`;
}

// A field on one line: name, type, whether it is required, what it is for.
export const field = (f: {
  name: string;
  type: string;
  required: boolean;
  description: string;
  options?: string[] | null;
}) =>
  `${f.name}: ${f.options ? `enum(${f.options.map(token).join("|")})` : f.type}${f.required ? ", required" : ""}${f.description ? ` — ${flat(f.description)}` : ""}`;

// The vocabulary: the person's own kinds with their fields, then the kinds
// colleagues shared in, each naming whose it is and how it reached here,
// then the verbs.
export function catalog(kinds: Kind[], verbs: Verb[]): string {
  const own = kinds.filter((k) => !k.via);
  const shared = kinds.filter((k) => k.via);
  const lines = [`kinds (${own.length} yours):`];
  for (const k of own) {
    lines.push(`${token(k.name)} — ${flat(k.description)}`);
    for (const p of k.properties) lines.push(`  ${field(p)}`);
  }
  if (shared.length) {
    lines.push(`shared in (${shared.length}), read with owner=…:`);
    for (const k of shared) {
      lines.push(
        `${token(k.name)} owner=${k.ownerId} ${k.via!.whole ? "whole kind" : "some records"}, ${k.via!.everyone ? "to everyone" : "to you"} — ${flat(k.description)}`,
      );
      for (const p of k.properties) lines.push(`  ${field(p)}`);
    }
  }
  lines.push(`verbs (${verbs.length}):`);
  for (const v of verbs)
    lines.push(`${token(v.name)} — ${flat(v.description)}`);
  return lines.join("\n");
}

// Columns the log carries that say nothing a reader wants.
const NOISE = new Set([
  "org_id",
  "person_id",
  "author",
  "updated_at",
  "created_at",
  "version",
  "id",
]);
const brief = (v: unknown) => cut(quoted(v) ?? "null", 80);

// Two texts cut to the stretch where they part, so a change deep in a body
// shows instead of the same opening twice.
function differing(a: string, b: string): [string, string] {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 20);
  const window = (s: string) =>
    quoted(`${from ? "…" : ""}${cut(s.slice(from), 60)}`);
  return [window(a), window(b)];
}

// One change from the log: what, when, by whom, and only the fields that
// moved.
export function event(e: Event, me: string): string {
  const head = `#${e.n} ${when(e.at)} ${e.subject} ${e.subjectId} ${e.action} by=${by(e.author, me)}`;
  const before = (e.before ?? {}) as Record<string, unknown>;
  const after = (e.after ?? {}) as Record<string, unknown>;
  if (e.subject === "share") {
    const row = e.action === "deleted" ? before : after;
    const to =
      row.subject === "group"
        ? `group ${quoted(String(row.group))}`
        : row.subject === "member"
          ? "a colleague"
          : "everyone";
    const what = row.kind
      ? `kind ${token(String(row.kind))}`
      : `record ${row.record_id} ${quoted(String(row.record ?? ""))}`;
    return `${head}: ${what} to ${to} at ${row.level}`;
  }
  if (e.action === "created" || e.action === "deleted") {
    const row = e.action === "created" ? after : before;
    const name = row.title ?? row.name ?? row.verb;
    const kind = row.kind ? `${row.kind} ` : "";
    return name === undefined
      ? head
      : `${head}: ${kind}${quoted(String(name))}`;
  }
  const moved = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !NOISE.has(k) && quoted(before[k]) !== quoted(after[k]))
    .map((k) => {
      const [b, a] = [before[k], after[k]];
      const [was, is] =
        typeof b === "string" && typeof a === "string"
          ? differing(b, a)
          : [brief(b), brief(a)];
      return `${k} ${was}→${is}`;
    });
  return moved.length ? `${head}: ${moved.join("; ")}` : head;
}
