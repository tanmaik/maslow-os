import { asMachine, asOrg, asPerson } from "./index.ts";
import type { Principal } from "./auth.ts";

// Every call a machine made to a model through the gateway, on its
// person's account: written before the vendor hears of it, settled with its
// tokens and the vendor's own price when the answer ends. The meter reads
// it; the person reads their own.

// Writes a call before it is made, as the machine making it for its person:
// the model, and nothing spent yet. Null when no machine of ours says that.
export async function beginModelCall(
  machineId: string,
  secret: string,
  call: { provider: string; model: string },
): Promise<string | null> {
  return asMachine(
    machineId,
    secret,
    async (q) =>
      (
        await q.query<{ id: string }>(
          `insert into model_calls (org_id, user_id, computer_id, provider, model)
           select org_id, user_id, id, $2, $3 from computers
            where machine_id = $1 and id in (select computer_id from computer_secrets)
           returning id`,
          [machineId, call.provider, call.model],
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
  // Settled by the sweep, not by its answer: what it cost is not known.
  lost: boolean;
  at: Date;
};

const COLUMNS = `provider, model, input_tokens::float8 as "inputTokens", output_tokens::float8 as "outputTokens",
  cache_read_tokens::float8 as "cacheReadTokens", cache_write_tokens::float8 as "cacheWriteTokens",
  reported_cost::float8 as "reportedCost", lost, at`;

type Query = {
  query: (text: string, values: unknown[]) => Promise<{ rows: any[] }>;
};

// Every settled call of the person's since a moment.
export async function modelCallsOf(
  p: Principal,
  since: Date,
): Promise<ModelCall[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<ModelCall>(
          `select ${COLUMNS} from model_calls
            where user_id = $1 and settled_at > $2 order by settled_at`,
          [p.userId, since],
        )
      ).rows,
  );
}

// Every call a member made in a window, for the meter. Runs inside an org
// scope the caller holds.
export async function modelCallsBetween(
  q: Query,
  userId: string,
  from: Date,
  to: Date,
): Promise<ModelCall[]> {
  return (
    await q.query(
      `select ${COLUMNS} from model_calls
        where user_id = $1 and settled_at > $2 and settled_at <= $3 order by settled_at`,
      [userId, from, to],
    )
  ).rows;
}

// What an org, or one of its members, has spent on models since a moment,
// at the vendors' reported or listed prices, for the caps at the gate.
export async function modelSpendOf(
  orgId: string,
  since: Date,
  price: (call: ModelCall) => number,
  userId?: string,
): Promise<number> {
  return asOrg(orgId, async (q) => {
    // Every member's calls, as the meter reads them.
    await q.query("select set_config('app.meter', 'sweep', true)");
    const rows = (
      await q.query<ModelCall>(
        `select ${COLUMNS} from model_calls
          where org_id = $2 and settled_at > $1 and ($3::uuid is null or user_id = $3)`,
        [since, orgId, userId ?? null],
      )
    ).rows;
    return rows.reduce((n, c) => n + price(c), 0);
  });
}

// Calls the app lost track of: begun before a moment no answer outlasts and
// never settled. Settled as they stood and marked, so the page and the
// meter see them.
export async function settleLostCalls(
  orgId: string,
  before: Date,
): Promise<void> {
  await asOrg(orgId, async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    await q.query(
      `update model_calls set settled_at = now(), lost = true
        where org_id = $2 and settled_at is null and at < $1`,
      [before, orgId],
    );
  });
}
