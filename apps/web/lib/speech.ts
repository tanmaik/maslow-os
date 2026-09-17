import { deployment } from "@/lib/deployment";

// Where a person's browser streams their voice to be heard as words, and
// what it carries to be let in: Deepgram's listening socket and a token of
// theirs good for a minute, minted with the key that never leaves our
// server. The audio goes straight from the phone to Deepgram, never
// through us, as the door's sockets do.
export type Ear = { url: string; token: string };

const LISTEN =
  "wss://api.deepgram.com/v1/listen?" +
  new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    endpointing: "300",
  }).toString();

export async function ear(): Promise<Ear | null> {
  const d = deployment.speech;
  if (d.kind === "none") return null;
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      authorization: `Token ${d.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 60 }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Deepgram answered ${res.status}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return { url: LISTEN, token: access_token };
}
