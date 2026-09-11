import { createHash } from "node:crypto";

import { deployment } from "./deployment";

// Text to vectors, through Voyage or a stand-in. The vectors are unit length
// so a dot product is a cosine. What is stored under one model name is
// comparable only with vectors of the same name, so the name carries the
// dimension.

const DIMENSION = 512;

// The model turned us away for asking too often, in its own words.
export class RateLimited extends Error {}

// Which vectors this deployment makes, or null when it makes none.
export function model(): string | null {
  const e = deployment.embeddings;
  return e.kind === "voyage"
    ? `${e.model}/${DIMENSION}`
    : e.kind === "fake"
      ? `fake/${DIMENSION}`
      : null;
}

const unit = (v: number[]) => {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
};

// A stand-in for a model: words and pairs of words hashed into a vector, so
// two texts about the same things land near each other. Enough to see the
// feature work with no key; never what production runs.
function pretend(text: string): number[] {
  const v = new Array<number>(DIMENSION).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const grams = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  for (const g of grams) {
    const h = createHash("sha1").update(g).digest();
    v[h.readUInt16BE(0) % DIMENSION]! += h[2]! & 1 ? 1 : -1;
  }
  return unit(v);
}

type VoyageAnswer = {
  data: { embedding: number[]; index: number }[];
  usage: { total_tokens: number };
};

export type Embedded = { vectors: number[][]; tokens: number };

// Roughly what a model would count a text as, for the stand-in's meter.
const roughTokens = (text: string) => Math.ceil(text.length / 4);

// Vectors for texts, in order, and the tokens the vendor counted. A
// question is embedded as a query and a record as a document, as Voyage
// asks.
export async function embed(
  texts: string[],
  as: "query" | "document",
): Promise<Embedded> {
  if (texts.length === 0) return { vectors: [], tokens: 0 };
  const e = deployment.embeddings;
  if (e.kind === "fake") {
    return {
      vectors: texts.map(pretend),
      tokens: texts.reduce((n, t) => n + roughTokens(t), 0),
    };
  }
  if (e.kind === "none") throw new Error("This deployment makes no vectors.");
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${e.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: e.model,
      input_type: as,
      output_dimension: DIMENSION,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429)
    throw new RateLimited(
      `the vector model is rate limited: ${(await res.text()).slice(0, 300)}`,
    );
  if (!res.ok) {
    throw new Error(
      `Voyage answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const answer = (await res.json()) as VoyageAnswer;
  return {
    vectors: answer.data
      .sort((a, b) => a.index - b.index)
      .map((d) => unit(d.embedding)),
    tokens: answer.usage.total_tokens,
  };
}
