import type {
  BrainRecord,
  BrainType,
  Edge,
  Event,
  Person,
} from "@maslow/brain";
import type { Notification } from "@maslow/db/notifications";

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

// One record on a line: id, type, when it was last modified, title, then its
// origin, standing and fields. Below it the body, whole or its first line.
export function record(
  r: BrainRecord,
  detail: "brief" | "full" = "brief",
): string {
  const parts = [
    r.id,
    token(r.type),
    when(r.updatedAt),
    quoted(r.title),
    `src=${token(r.source)}:${token(r.sourceRef)}`,
  ];
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

// An edge as a sentence: from, verb, to.
export function edge(e: Edge): string {
  return [e.id, e.fromId, token(e.verb), e.toId].join(" ");
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
  return `  ${parts.join(" ")}`;
}

// A field on one line: name, what it holds, whether it is required.
export const field = (f: {
  name: string;
  datatype: string;
  required: boolean;
  options?: string[] | null;
}) =>
  `${f.name}: ${f.options ? `enum(${f.options.map(token).join("|")})` : f.datatype}${f.required ? ", required" : ""}`;

// The vocabulary: the person's own types with their fields, then the types
// colleagues shared in, each naming whose it is, then who is in the org,
// each by the email an ask names them by.
export function catalog(
  types: BrainType[],
  people: Person[],
  me: string,
): string {
  const own = types.filter((t) => t.own);
  const shared = types.filter((t) => !t.own);
  const named = new Map(people.map((p) => [p.id, p]));
  const lines = [`types (${own.length} yours):`];
  for (const t of own) {
    lines.push(token(t.name));
    for (const p of t.properties) lines.push(`  ${field(p)}`);
  }
  if (shared.length) {
    lines.push(`shared in (${shared.length}):`);
    for (const t of shared) {
      const owner = named.get(t.ownerId);
      lines.push(
        `${token(t.name)} owner=${owner ? token(owner.email) : t.ownerId}`,
      );
      for (const p of t.properties) lines.push(`  ${field(p)}`);
    }
  }
  lines.push(`people (${people.length}):`);
  for (const p of people) {
    lines.push(
      `${token(p.name)} ${token(p.email)}${p.id === me ? " (the person)" : ""}`,
    );
  }
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
    const what = row.type
      ? `type ${token(String(row.type))}`
      : `record ${row.record_id} ${quoted(String(row.record ?? ""))}`;
    return `${head}: ${what} to ${to} at ${row.level}`;
  }
  if (e.action === "created" || e.action === "deleted") {
    const row = e.action === "created" ? after : before;
    const name = row.title ?? row.name ?? row.verb;
    const type = row.type ? `${row.type} ` : "";
    return name === undefined
      ? head
      : `${head}: ${type}${quoted(String(name))}`;
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

// One notification on a line: id, kind, when it was left, its title, whether the
// person has seen it, then what an ask offers, what was answered, and the
// records it points at. Below it the body it carries.
// A widget on the desktop: id "title" href at x,y size w×h, shares of the
// desktop to two places.
export function widget(w: {
  id: string;
  title: string;
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}): string {
  const at = (n: number) => n.toFixed(2);
  return `${w.id} ${quoted(flat(w.title))} ${w.href} at ${at(w.x)},${at(w.y)} size ${at(w.w)}×${at(w.h)}`;
}

export function notification(n: Notification): string {
  const parts = [
    n.id,
    n.kind,
    when(new Date(n.createdAt)),
    quoted(n.title),
    n.readAt ? "read" : "unread",
  ];
  if (n.options.length) parts.push(`options=${n.options.map(token).join("|")}`);
  if (n.answer !== null) parts.push(`answered=${token(n.answer)}`);
  else if (n.kind === "ask") parts.push("waiting");
  if (n.records.length) parts.push(`about=${n.records.join(",")}`);
  const body = linesOf(n.body).trim();
  return body
    ? `${parts.join(" ")}\n${body.replace(/^/gm, "  ")}`
    : parts.join(" ");
}
