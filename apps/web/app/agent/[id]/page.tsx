import {
  eventsOf,
  modelCallsOfSession,
  sawSession,
  sessionOf,
} from "@placeholder/db/agents";
import { isUuid } from "@placeholder/db";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";

import { Conversation } from "@/components/agent/conversation";
import { acpUrl } from "@/lib/agent";
import { ensureFilesystem, status } from "@/lib/computer";
import { DiskError } from "@/lib/disk";
import { costOf, offered } from "@/lib/models";
import { principal } from "@/lib/session";

// Vercel gives this request this long: the machine may be waking.
export const maxDuration = 60;

// One conversation: what has happened so far from the database, then the
// browser takes over on the machine's own socket.
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await sessionOf(p, id);
  if (!session) notFound();
  // Opening it is seeing it: whatever finished since is read now.
  after(() => sawSession(p, id));
  const events = await eventsOf(p, id);
  const models = offered();
  // What this conversation has cost so far, from every call it made
  // through the gateway, at the vendor's own price where it gave one.
  const calls = await modelCallsOfSession(p, id);
  const spend = {
    usd: calls.reduce((n, c) => n + costOf(c), 0),
    tokens: calls.reduce(
      (n, c) =>
        n +
        c.inputTokens +
        c.outputTokens +
        c.cacheReadTokens +
        c.cacheWriteTokens,
      0,
    ),
    cached: calls.reduce((n, c) => n + c.cacheReadTokens, 0),
    calls: calls.length,
  };
  let url: string | null = null;
  let shell = false;
  let trouble: string | null = null;
  try {
    // The machine as Fly sees it now: one gone behind our back is forgotten
    // here, so the links below name a machine that will answer.
    if (!(await status(p))) await ensureFilesystem(p);
    url = await acpUrl(p, id);
    shell = true;
  } catch (err) {
    if (!(err instanceof DiskError)) throw err;
    trouble = err.message;
  }
  return (
    <Conversation
      key={session.id}
      session={{
        id: session.id,
        title: session.title,
        model: session.model,
        state: session.state,
        settled: session.settledAt !== null,
      }}
      events={events.map((e) => ({ ...e, at: e.at.toISOString() }))}
      url={url}
      shell={shell}
      trouble={trouble}
      models={models.map((m) => ({ id: m.id, label: m.label }))}
      faked={models.length === 0}
      spend={spend}
    />
  );
}
