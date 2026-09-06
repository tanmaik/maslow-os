import { asMachine, asOrg, asPerson } from "./index.ts";
import type { Principal } from "./auth.ts";

// A conversation with the agent on the person's machine, and what happened
// in it. The person reads and names sessions; the machine writes what the
// agent did, as itself.
export type Session = {
  id: string;
  userId: string;
  computerId: string;
  title: string;
  model: string;
  acpSessionId: string | null;
  state: "idle" | "working" | "restarted";
  createdAt: Date;
  updatedAt: Date;
  // When the person set it aside; null while it is live.
  settledAt: Date | null;
  // When the person last opened it, and when a turn last finished: a
  // finish after the last look is unread.
  seenAt: Date | null;
  finishedAt: Date | null;
};

export type AgentEvent = {
  seq: number;
  kind: string;
  body: Record<string, unknown>;
  at: Date;
};

const COLUMNS =
  'id, user_id as "userId", computer_id as "computerId", title, model, acp_session_id as "acpSessionId", state, created_at as "createdAt", updated_at as "updatedAt", settled_at as "settledAt", seen_at as "seenAt", finished_at as "finishedAt"';

// The person's sessions, most recently touched first.
export async function sessionsOf(p: Principal): Promise<Session[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<Session>(
          `select ${COLUMNS} from agent_sessions where user_id = $1 order by updated_at desc`,
          [p.userId],
        )
      ).rows,
  );
}

export async function sessionOf(
  p: Principal,
  id: string,
): Promise<Session | null> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<Session>(
          `select ${COLUMNS} from agent_sessions where id = $1 and user_id = $2`,
          [id, p.userId],
        )
      ).rows[0] ?? null,
  );
}

export async function eventsOf(
  p: Principal,
  sessionId: string,
): Promise<AgentEvent[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<AgentEvent>(
          "select seq, kind, body, at from agent_events where session_id = $1 order by seq",
          [sessionId],
        )
      ).rows,
  );
}

export async function createSession(
  p: Principal,
  s: { id: string; computerId: string; model: string },
): Promise<void> {
  await asPerson(p, (q) =>
    q.query(
      "insert into agent_sessions (id, user_id, computer_id, model) values ($1, $2, $3, $4)",
      [s.id, p.userId, s.computerId, s.model],
    ),
  );
}

export async function renameSession(
  p: Principal,
  id: string,
  title: string,
): Promise<void> {
  await asPerson(p, (q) =>
    q.query(
      "update agent_sessions set title = $1, updated_at = now() where id = $2 and user_id = $3",
      [title, id, p.userId],
    ),
  );
}

// Sets a conversation aside, or brings it back.
export async function settleSession(
  p: Principal,
  id: string,
  settled: boolean,
): Promise<void> {
  await asPerson(p, (q) =>
    q.query(
      "update agent_sessions set settled_at = case when $1 then now() else null end where id = $2 and user_id = $3",
      [settled, id, p.userId],
    ),
  );
}

// The person opened it: what had finished is now seen.
export async function sawSession(p: Principal, id: string): Promise<void> {
  await asPerson(p, (q) =>
    q.query(
      "update agent_sessions set seen_at = now() where id = $1 and user_id = $2",
      [id, p.userId],
    ),
  );
}

export async function deleteSession(p: Principal, id: string): Promise<void> {
  await asPerson(p, (q) =>
    q.query("delete from agent_sessions where id = $1 and user_id = $2", [
      id,
      p.userId,
    ]),
  );
}

// A session as the machine behind it sees it: the one it is asked about, if
// it belongs to the computer whose secret this is. Null is all a stranger
// gets.
export type MachineSession = {
  id: string;
  orgId: string;
  userId: string;
  computerId: string;
  model: string;
  acpSessionId: string | null;
  // The last event number the app holds for it.
  seq: number;
};

export async function sessionForMachine(
  machineId: string,
  secret: string,
  sessionId: string,
): Promise<MachineSession | null> {
  return asMachine(
    machineId,
    secret,
    async (q) =>
      (
        await q.query<MachineSession>(
          `select s.id, s.org_id as "orgId", s.user_id as "userId", s.computer_id as "computerId", s.model, s.acp_session_id as "acpSessionId",
                  coalesce((select max(seq) from agent_events e where e.session_id = s.id), 0)::int as seq
             from agent_sessions s join computers c on c.id = s.computer_id
            where s.id = $1 and c.machine_id = $2`,
          [sessionId, machineId],
        )
      ).rows[0] ?? null,
  );
}

// What the machine says happened, kept once per seq; the session's title,
// model and state follow from the events. False when the session is not
// the machine's.
export async function recordEvents(
  machineId: string,
  secret: string,
  sessionId: string,
  acpSessionId: string | null,
  events: { seq: number; kind: string; body: Record<string, unknown> }[],
): Promise<boolean> {
  return asMachine(machineId, secret, async (q) => {
    const s = (
      await q.query<{ id: string }>(
        "select s.id from agent_sessions s join computers c on c.id = s.computer_id where s.id = $1 and c.machine_id = $2 for update of s",
        [sessionId, machineId],
      )
    ).rows[0];
    if (!s) return false;
    // Only what is new says anything about the session; a batch told twice
    // changes nothing.
    const fresh: typeof events = [];
    for (const e of events) {
      const inserted = await q.query(
        `insert into agent_events (org_id, session_id, seq, kind, body)
         select org_id, id, $2, $3, $4 from agent_sessions where id = $1
         on conflict (session_id, seq) do nothing
         returning seq`,
        [sessionId, e.seq, e.kind, JSON.stringify(e.body)],
      );
      if (inserted.rows.length) fresh.push(e);
    }
    if (!fresh.length) return true;
    events = fresh;
    // The last event that says whether the agent is working; a title or a
    // tool arriving after the result does not undo it.
    const last = events.findLast((e) =>
      ["prompt", "wake", "result", "restart"].includes(e.kind),
    );
    // The harness names the conversation when it can; until then the first
    // prompt does, cut short.
    const named = events.filter((e) => e.kind === "title").at(-1)?.body.title;
    const asked = events.find((e) => e.kind === "prompt")?.body.text;
    const title =
      typeof named === "string" && named.trim()
        ? named.trim()
        : typeof asked === "string" && asked.trim()
          ? shorten(asked.trim())
          : null;
    const model = events.filter((e) => e.kind === "model").at(-1)?.body.model;
    const state =
      last?.kind === "prompt" || last?.kind === "wake"
        ? "working"
        : last?.kind === "result"
          ? "idle"
          : last?.kind === "restart"
            ? "restarted"
            : null;
    await q.query(
      `update agent_sessions
          set title = case
                when $6::boolean or title = 'New conversation' then coalesce($2, title)
                else title end,
              model = coalesce($3, model),
              state = coalesce($4, state),
              acp_session_id = coalesce($5, acp_session_id),
              finished_at = case when $4 = 'idle' then now() else finished_at end,
              -- A conversation the agent wrote into comes back to the live list.
              settled_at = case when $7::boolean then null else settled_at end,
              updated_at = now()
        where id = $1`,
      [
        sessionId,
        title,
        typeof model === "string" ? model : null,
        state,
        acpSessionId,
        typeof named === "string" && named.trim() !== "",
        events.some((e) => e.kind === "prompt"),
      ],
    );
    return true;
  });
}

// A machine has booted with these turns still in flight; every other
// conversation of its that was working lost its turn with the machine, and
// gets a restart event saying so. False for a stranger.
export async function finishLostTurns(
  machineId: string,
  secret: string,
  inFlight: string[],
): Promise<boolean> {
  return asMachine(machineId, secret, async (q) => {
    const known = (
      await q.query("select 1 from computers where machine_id = $1", [
        machineId,
      ])
    ).rows.length;
    if (!known) return false;
    const lost = (
      await q.query<{ id: string }>(
        `select s.id from agent_sessions s join computers c on c.id = s.computer_id
          where c.machine_id = $1 and s.state = 'working' and not (s.id = any($2::uuid[]))
          for update of s`,
        [machineId, inFlight],
      )
    ).rows;
    for (const { id } of lost) {
      await q.query(
        `insert into agent_events (org_id, session_id, seq, kind, body)
         select org_id, id, coalesce((select max(seq) from agent_events where session_id = $1), 0) + 1, 'restart', '{}'
           from agent_sessions where id = $1
         on conflict (session_id, seq) do nothing`,
        [id],
      );
      await q.query(
        "update agent_sessions set state = 'restarted', finished_at = now(), updated_at = now() where id = $1 and state = 'working'",
        [id],
      );
    }
    return true;
  });
}

// A title from a prompt: its first line, no longer than a sidebar row.
const shorten = (text: string) => {
  const line = text.split("\n")[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
};

// One call to a model through the gateway, on the machine's account: who it
// was for follows from the machine. False for a stranger.
// Writes a call before it is made, as the machine making it for its person:
// the model, and nothing spent yet. Null when no machine of ours says that.
export async function beginModelCall(
  machineId: string,
  secret: string,
  call: { sessionId: string | null; provider: string; model: string },
): Promise<string | null> {
  return asMachine(
    machineId,
    secret,
    async (q) =>
      (
        await q.query<{ id: string }>(
          `insert into model_calls (org_id, user_id, computer_id, session_id, provider, model)
           select org_id, user_id, id, $2, $3, $4 from computers
            where machine_id = $1 and id in (select computer_id from computer_secrets)
           returning id`,
          [machineId, call.sessionId, call.provider, call.model],
        )
      ).rows[0]?.id ?? null,
  );
}

export type Tokens = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reportedCost: number | null;
};

// Writes what the call cost once the answer has ended.
export async function settleModelCall(
  machineId: string,
  secret: string,
  id: string,
  t: Tokens,
): Promise<void> {
  await asMachine(machineId, secret, (q) =>
    q.query(
      `update model_calls
          set input_tokens = $2, output_tokens = $3, cache_read_tokens = $4,
              cache_write_tokens = $5, reported_cost = coalesce($6, reported_cost),
              settled_at = coalesce(settled_at, now())
        where id = $1`,
      [
        id,
        t.inputTokens,
        t.outputTokens,
        t.cacheReadTokens,
        t.cacheWriteTokens,
        t.reportedCost,
      ],
    ),
  );
}

// Forgets a call the vendor refused before anything was bought.
export async function dropModelCall(
  machineId: string,
  secret: string,
  id: string,
): Promise<void> {
  await asMachine(machineId, secret, (q) =>
    q.query("delete from model_calls where id = $1", [id]),
  );
}

export type ModelCall = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reportedCost: number | null;
  at: Date;
};

// Every call made in one of the person's sessions, for the page to price.
export async function modelCallsOfSession(
  p: Principal,
  sessionId: string,
): Promise<ModelCall[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<ModelCall>(
          `select provider, model, input_tokens::float8 as "inputTokens", output_tokens::float8 as "outputTokens",
                  cache_read_tokens::float8 as "cacheReadTokens", cache_write_tokens::float8 as "cacheWriteTokens",
                  reported_cost::float8 as "reportedCost", at
             from model_calls where session_id = $1 and user_id = $2 order by at`,
          [sessionId, p.userId],
        )
      ).rows,
  );
}

// Every settled call of the person's since a moment, across their sessions.
export async function modelCallsOf(
  p: Principal,
  since: Date,
): Promise<ModelCall[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<ModelCall>(
          `select provider, model, input_tokens::float8 as "inputTokens", output_tokens::float8 as "outputTokens",
                  cache_read_tokens::float8 as "cacheReadTokens", cache_write_tokens::float8 as "cacheWriteTokens",
                  reported_cost::float8 as "reportedCost", at
             from model_calls
            where user_id = $1 and settled_at > $2
            order by settled_at`,
          [p.userId, since],
        )
      ).rows,
  );
}

// Every call a member made in a window, for the meter. Runs inside an org
// scope the caller holds.
export async function modelCallsBetween(
  q: { query: (text: string, values: unknown[]) => Promise<{ rows: any[] }> },
  userId: string,
  from: Date,
  to: Date,
): Promise<ModelCall[]> {
  return (
    await q.query(
      `select provider, model, input_tokens::float8 as "inputTokens", output_tokens::float8 as "outputTokens",
              cache_read_tokens::float8 as "cacheReadTokens", cache_write_tokens::float8 as "cacheWriteTokens",
              reported_cost::float8 as "reportedCost", at
         from model_calls where user_id = $1 and settled_at > $2 and settled_at <= $3 order by settled_at`,
      [userId, from, to],
    )
  ).rows;
}

// What the org has spent on models since a moment, at the vendors' reported
// or listed prices, for the cap at the gate.
export async function modelSpendOf(
  orgId: string,
  since: Date,
  price: (call: ModelCall) => number,
): Promise<number> {
  return asOrg(orgId, async (q) => {
    // Every member's calls, as the meter reads them.
    await q.query("select set_config('app.meter', 'sweep', true)");
    const rows = (
      await q.query<ModelCall>(
        `select provider, model, input_tokens::float8 as "inputTokens", output_tokens::float8 as "outputTokens",
                cache_read_tokens::float8 as "cacheReadTokens", cache_write_tokens::float8 as "cacheWriteTokens",
                reported_cost::float8 as "reportedCost", at
           from model_calls where org_id = $2 and settled_at > $1`,
        [since, orgId],
      )
    ).rows;
    return rows.reduce((n, c) => n + price(c), 0);
  });
}
