import type { ModelCall } from "@placeholder/db/agents";

import { deployment } from "./deployment.ts";

// The models an agent can run on, each behind the vendor that serves it,
// with the vendor's list price in dollars per million tokens, from
// OpenRouter's `GET /api/v1/models`, read 2026-09-04. One model for now: the
// harness sends tens of thousands of tokens of its own with every call, so
// the price per token is the whole bill. A bare Claude id would go to
// Anthropic; a `vendor/model` id goes to OpenRouter, which speaks the same
// protocol.
export type Provider = "anthropic" | "openrouter";

export type Model = {
  id: string;
  label: string;
  provider: Provider;
  // Claude Code is built for Claude; on anything else it may misbehave.
  claude: boolean;
  price: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

const openrouter = (
  id: string,
  label: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): Model => ({
  id,
  label,
  provider: "openrouter",
  claude: id.startsWith("anthropic/"),
  price: { input, output, cacheRead, cacheWrite },
});

// Anthropic's, from its price list read 2026-09-06: a cache read at a
// tenth of input and a cache write at a quarter over it.
const anthropic = (
  id: string,
  label: string,
  input: number,
  output: number,
): Model => ({
  id,
  label,
  provider: "anthropic",
  claude: true,
  price: { input, output, cacheRead: input / 10, cacheWrite: input * 1.25 },
});

export const CATALOG: Model[] = [
  anthropic("claude-sonnet-5", "Claude Sonnet 5", 2, 10),
  anthropic("claude-opus-5", "Claude Opus 5", 5, 25),
  anthropic("claude-haiku-4-5", "Claude Haiku 4.5", 1, 5),
  openrouter("z-ai/glm-5.3-flash", "GLM-5.3 Flash", 0.07, 0.25, 0.01, 0.07),
];

// Claude's own names, as OpenRouter lists the same models at the same
// prices, read 2026-09-06.
const AT_OPENROUTER: Record<string, string> = {
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "claude-opus-5": "anthropic/claude-opus-5",
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
};

// The model a new conversation runs on: Claude, since the harness is
// built for it, or else the first the deployment offers.
export const defaultModel = () =>
  offered().find((m) => m.claude)?.id ?? offered()[0]?.id ?? CATALOG[0]!.id;

// What one org may spend on models in a month before the gate refuses. The
// abuse limit, not a plan.
export const MODEL_CAP_USD = 200;

export const providerOf = (id: string): Provider =>
  id.includes("/") ? "openrouter" : "anthropic";

// The models this deployment can actually serve: Claude's from either
// vendor, the rest from OpenRouter.
export function offered(): Model[] {
  const m = deployment.models;
  if (m.kind === "none") return [];
  return CATALOG.filter((x) =>
    x.provider === "anthropic" ? m.anthropic || m.openrouter : m.openrouter,
  );
}

export const modelById = (id: string): Model | undefined =>
  CATALOG.find((m) => m.id === id);

// Where a request for this model goes, with what key, and under what name
// the vendor knows it; null when the deployment has no key for it. A
// Claude model goes to Anthropic when there is a key for it, else to
// OpenRouter under OpenRouter's name for it.
export function routeFor(id: string): {
  provider: Provider;
  url: string;
  headers: Record<string, string>;
  model: string;
} | null {
  const m = deployment.models;
  if (m.kind === "none") return null;
  if (providerOf(id) === "anthropic" && m.anthropic)
    return {
      provider: "anthropic",
      url: "https://api.anthropic.com",
      headers: { "x-api-key": m.anthropic },
      model: id,
    };
  const at = providerOf(id) === "anthropic" ? AT_OPENROUTER[id] : id;
  return m.openrouter && at
    ? {
        provider: "openrouter",
        url: "https://openrouter.ai/api",
        headers: { authorization: `Bearer ${m.openrouter}` },
        model: at,
      }
    : null;
}

// What one call cost in dollars: the vendor's own figure when it gave one,
// else its list price times the tokens. A model the catalog no longer
// names costs nothing here and is said in the log.
export function costOf(c: ModelCall): number {
  if (c.reportedCost !== null) return c.reportedCost;
  const m = modelById(c.model);
  if (!m) {
    console.error(`no price for model ${c.model}`);
    return 0;
  }
  return (
    (c.inputTokens * m.price.input +
      c.outputTokens * m.price.output +
      c.cacheReadTokens * m.price.cacheRead +
      c.cacheWriteTokens * m.price.cacheWrite) /
    1e6
  );
}
