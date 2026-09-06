import type { ModelCall } from "@placeholder/db/model-calls";

import { deployment } from "./deployment.ts";

// The models Claude Code on a computer can run on, each behind the vendor
// that serves it, with the vendor's list price in dollars per million
// tokens. One model, GLM, from OpenRouter: Claude Code sends tens of
// thousands of tokens of its own with every call, so the price per token
// is the whole bill.
// Claude Code was built for Claude and is told what to make of a model it
// does not know: the Claude to treat it like, and how much it holds.
export type Provider = "anthropic" | "openrouter";

export type Model = {
  id: string;
  label: string;
  provider: Provider;
  // The Claude whose handling Claude Code applies to this model.
  behavesAs: string;
  // The context window, in tokens.
  context: number;
  price: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

// From OpenRouter's `GET /api/v1/models`, read 2026-09-06: the window
// rounded down to a million.
export const CATALOG: Model[] = [
  {
    id: "z-ai/glm-5.3-flash",
    label: "GLM-5.3 Flash",
    provider: "openrouter",
    behavesAs: "claude-sonnet-5",
    context: 1_000_000,
    price: { input: 0.07, output: 0.25, cacheRead: 0.01, cacheWrite: 0.07 },
  },
];

// What one org may spend on models in a month, and one person in an hour,
// before the gate refuses. Abuse limits, not a plan.
export const MODEL_CAP_USD = 200;
export const MODEL_HOUR_CAP_USD = 10;

export const modelById = (id: string): Model | undefined =>
  CATALOG.find((m) => m.id === id);

// Where a request for this model goes, and with what key; null when the
// catalog does not name it or the deployment has no key for its vendor.
export function routeFor(
  id: string,
): { provider: Provider; url: string; headers: Record<string, string> } | null {
  const m = deployment.models;
  const model = modelById(id);
  if (m.kind === "none" || !model) return null;
  if (model.provider === "anthropic")
    return m.anthropic
      ? {
          provider: "anthropic",
          url: "https://api.anthropic.com",
          headers: { "x-api-key": m.anthropic },
        }
      : null;
  return m.openrouter
    ? {
        provider: "openrouter",
        url: "https://openrouter.ai/api",
        headers: { authorization: `Bearer ${m.openrouter}` },
      }
    : null;
}

// The models this deployment can actually serve.
export const offered = (): Model[] =>
  CATALOG.filter((m) => routeFor(m.id) !== null);

// The model Claude Code on a computer runs on.
export const defaultModel = (): Model => offered()[0] ?? CATALOG[0]!;

// What a machine is told about its model, for Claude Code on it.
export const modelEnv = (): Record<string, string> => {
  const m = defaultModel();
  return {
    MODEL: m.id,
    MODEL_LABEL: m.label,
    MODEL_BEHAVES_AS: m.behavesAs,
    MODEL_CONTEXT: String(m.context),
  };
};

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
