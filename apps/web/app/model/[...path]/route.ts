import {
  beginModelCall,
  dropModelCall,
  modelSpendOf,
  settleModelCall,
} from "@placeholder/db/agents";
import { computerByMachine } from "@placeholder/db/backups";
import { after } from "next/server";

import { deployment } from "@/lib/deployment";
import { machineFrom } from "@/lib/machine";
import {
  CATALOG,
  costOf,
  defaultModel,
  MODEL_CAP_USD,
  offered,
  providerOf,
  routeFor,
} from "@/lib/models";

// The model gateway: a machine speaks the Anthropic protocol to us with its
// own secret, and we speak it on to the vendor with the key the machine
// never holds. Every call is a row before it is made and settled with its
// tokens when the answer ends; an org past its monthly cap is refused at the
// door. A stranger gets a 404, as at every other door a machine knocks on.
// With no key, outside production, a pretend model answers and nothing is
// spent.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// An error in the shape the Anthropic client shows the person.
const refuse = (status: number, message: string) =>
  Response.json(
    { type: "error", error: { type: "api_error", message } },
    { status },
  );

// The pretend model's answer, with a usage the meter can read: what a shell
// or a harness gets on a deployment with no key, outside production.
function pretend(model: string, stream: boolean): Response {
  const usage = { input_tokens: 12, output_tokens: 7 };
  const text = "This is the pretend model. Nothing was spent.";
  if (!stream)
    return Response.json({
      id: "msg_pretend",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage,
    });
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_pretend",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { ...usage, output_tokens: 1 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: usage.output_tokens },
    },
    { type: "message_stop" },
  ];
  return new Response(
    events
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
    {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    },
  );
}

async function forward(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const machine = machineFrom(request);
  if (!machine) return new Response(null, { status: 404 });
  const { machineId, secret } = machine;
  const computer = await computerByMachine(machineId, secret);
  if (!computer) return new Response(null, { status: 404 });
  // The doors a harness knocks on, and no other: a Messages call is paid
  // for; the catalog and a token count are not, and pass through unwritten.
  const path = (await params).path.join("/");
  const paid = request.method === "POST" && path === "v1/messages";
  const free =
    (request.method === "GET" && path === "v1/models") ||
    (request.method === "POST" && path === "v1/messages/count_tokens");
  if (!paid && !free) return new Response(null, { status: 404 });
  const faked = deployment.models.kind === "none";
  if (faked && deployment.production)
    return refuse(404, "This deployment has no model.");

  const body = request.method === "GET" ? undefined : await request.text();
  let asked: { model?: unknown; stream?: unknown } = {};
  try {
    asked = body ? JSON.parse(body) : {};
  } catch {}
  // Only a model the catalog offers is paid for: the harness names one on
  // every call, and a call naming another is refused before it costs.
  const model = typeof asked.model === "string" ? asked.model : null;
  const catalog = faked ? CATALOG : offered();
  if (paid && !catalog.some((m) => m.id === model))
    return refuse(
      403,
      `${model ?? "No model"} is not one this deployment offers; the agent runs on ${catalog
        .map((m) => m.id)
        .join(", ")}.`,
    );
  const named = model ?? defaultModel();
  const route = faked
    ? { provider: providerOf(named), url: "", headers: {}, model: named }
    : routeFor(named);
  if (!route)
    return refuse(
      503,
      `This deployment has no key for the vendor of ${model}.`,
    );
  // The vendor is told the name it knows the model by; the ledger keeps
  // ours.
  const sent =
    body && route.model !== model
      ? JSON.stringify({ ...asked, model: route.model })
      : body;

  if (free) {
    if (faked)
      return Response.json(
        request.method === "GET" ? { data: [] } : { input_tokens: 0 },
      );
    const headers = new Headers();
    for (const name of [
      "content-type",
      "anthropic-version",
      "anthropic-beta",
    ]) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }
    for (const [k, v] of Object.entries(route.headers)) headers.set(k, v);
    const search = new URL(request.url).search;
    const up = await fetch(`${route.url}/${path}${search}`, {
      method: request.method,
      headers,
      body: sent,
    });
    // The body arrives decoded; only the headers that still describe it go
    // on.
    const out = new Headers();
    for (const name of ["content-type", "cache-control", "request-id"]) {
      const v = up.headers.get(name);
      if (v) out.set(name, v);
    }
    return new Response(up.body, { status: up.status, headers: out });
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const spent = await modelSpendOf(computer.orgId, monthStart, costOf);
  if (spent >= MODEL_CAP_USD)
    return refuse(
      429,
      `This org has spent $${spent.toFixed(2)} on models this month, past its $${MODEL_CAP_USD} limit. Ask us to raise it.`,
    );
  const sessionHeader = request.headers.get("x-agent-session");
  const sessionId =
    sessionHeader && UUID.test(sessionHeader) ? sessionHeader : null;
  // The call is a row before the vendor hears of it; if the row cannot be
  // written, nothing is bought.
  const callId = await beginModelCall(machineId, secret, {
    sessionId,
    provider: route.provider,
    model: model!,
  }).catch(() => null);
  if (!callId) return refuse(503, "The call could not be written down.");

  let upstream: Response;
  if (faked) {
    upstream = pretend(model!, asked.stream === true);
  } else {
    const headers = new Headers();
    for (const name of [
      "content-type",
      "accept",
      "anthropic-version",
      "anthropic-beta",
    ]) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }
    for (const [k, v] of Object.entries(route.headers)) headers.set(k, v);
    // OpenRouter keeps one conversation's calls on one upstream cache when
    // told which conversation they belong to; the vendor caches the rest.
    if (route.provider === "openrouter" && sessionId)
      headers.set("x-session-id", sessionId);
    const search = new URL(request.url).search;
    try {
      upstream = await fetch(`${route.url}/${path}${search}`, {
        method: request.method,
        headers,
        body: sent,
        signal: AbortSignal.timeout(maxDuration * 1000 - 5000),
      });
    } catch (err) {
      await dropModelCall(machineId, secret, callId).catch(() => {});
      return refuse(
        502,
        `${route.provider} did not answer: ${(err as Error).message}`,
      );
    }
  }

  const out = new Headers();
  for (const name of [
    "content-type",
    "cache-control",
    "request-id",
    "anthropic-ratelimit-tokens-remaining",
  ]) {
    const v = upstream.headers.get(name);
    if (v) out.set(name, v);
  }
  // A refusal before any answer is a call the vendor does not bill.
  if (!upstream.ok || !upstream.body) {
    await dropModelCall(machineId, secret, callId).catch(() => {});
    return new Response(upstream.body, {
      status: upstream.status,
      headers: out,
    });
  }
  const usage = new Usage();
  // The row is settled once the answer has passed, or once the reader has
  // left, with the tokens the vendor reported by then; a vendor that keeps
  // its own account of the call is then asked for the exact price, which
  // lands on the settled row.
  let finished!: () => void;
  const done = new Promise<void>((r) => (finished = r));
  after(async () => {
    await done;
    const tokens = usage.tokens();
    if (faked) tokens.reportedCost = 0;
    const settle = () =>
      settleModelCall(machineId, secret, callId, tokens).catch((err) =>
        console.error(`model call unsettled: ${err.message}`),
      );
    await settle();
    if (route.provider === "openrouter" && tokens.reportedCost === null) {
      tokens.reportedCost = await openrouterCost(route, usage.id);
      if (tokens.reportedCost !== null) await settle();
    }
  });
  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    // The stream passes through untouched; each event is read as it goes by.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let tail = "";
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await reader.read();
        } catch (err) {
          finished();
          controller.error(err);
          return;
        }
        if (next.done) {
          usage.line(tail);
          finished();
          controller.close();
          return;
        }
        controller.enqueue(next.value);
        tail += decoder.decode(next.value, { stream: true });
        const lines = tail.split("\n");
        tail = lines.pop() ?? "";
        for (const line of lines) usage.line(line);
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          finished();
        }
      },
    });
    return new Response(stream, { status: upstream.status, headers: out });
  }
  let text: string;
  try {
    text = await upstream.text();
  } catch (err) {
    finished();
    throw err;
  }
  try {
    usage.message(JSON.parse(text));
  } catch {}
  finished();
  return new Response(text, { status: upstream.status, headers: out });
}

// What OpenRouter charged for one generation, in dollars, from its own
// account of it; the figure lands a moment after the answer, so it is asked
// for a few times. Null when it never says.
async function openrouterCost(
  route: { url: string; headers: Record<string, string> },
  id: string | null,
): Promise<number | null> {
  if (!id) return null;
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    try {
      const res = await fetch(
        `${route.url}/v1/generation?id=${encodeURIComponent(id)}`,
        { headers: route.headers, signal: AbortSignal.timeout(10_000) },
      );
      if (res.status === 404) continue;
      if (!res.ok) return null;
      const { data } = (await res.json()) as {
        data?: { total_cost?: number };
      };
      if (typeof data?.total_cost === "number") return data.total_cost;
    } catch {
      return null;
    }
  }
  return null;
}

// The tokens a Messages call used, read off the events as they pass:
// `message_start` says what went in, `message_delta` says what came out and,
// from a vendor that prices as it goes, what it cost.
class Usage {
  seen = false;
  // The vendor's id for the message, to ask it about the call afterwards.
  id: string | null = null;
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private cost: number | null = null;

  line(line: string) {
    if (!line.startsWith("data:")) return;
    try {
      const data = JSON.parse(line.slice(5));
      if (data.type === "message_start") {
        if (typeof data.message?.id === "string") this.id = data.message.id;
        this.take(data.message?.usage);
      }
      if (data.type === "message_delta") this.take(data.usage);
    } catch {}
  }

  message(m: { id?: unknown; usage?: unknown }) {
    if (typeof m?.id === "string") this.id = m.id;
    this.take(m?.usage);
  }

  private take(u: unknown) {
    if (!u || typeof u !== "object") return;
    const n = (k: string) => {
      const v = (u as Record<string, unknown>)[k];
      return typeof v === "number" ? v : null;
    };
    this.seen = true;
    this.input = Math.max(this.input, n("input_tokens") ?? 0);
    this.output = Math.max(this.output, n("output_tokens") ?? 0);
    this.cacheRead = Math.max(
      this.cacheRead,
      n("cache_read_input_tokens") ?? 0,
    );
    this.cacheWrite = Math.max(
      this.cacheWrite,
      n("cache_creation_input_tokens") ?? 0,
    );
    const cost = n("cost");
    if (cost !== null) this.cost = cost;
  }

  tokens() {
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      cacheReadTokens: this.cacheRead,
      cacheWriteTokens: this.cacheWrite,
      reportedCost: this.cost,
    };
  }
}

export { forward as GET, forward as POST };
