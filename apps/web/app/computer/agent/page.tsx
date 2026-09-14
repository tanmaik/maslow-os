import { asOrg } from "@maslow/db";
import { computerOf } from "@maslow/db/computers";
import { redirect } from "next/navigation";

import { Agent } from "@/app/computer/agent/agent";
import { ComputerWaiting } from "@/components/computer-waiting";
import { stateNow } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// The person's computer as a conversation: the same Claude Code the
// terminal runs, over the Agent Client Protocol, on the machine itself.
export default async function AgentPage() {
  const p = await principal();
  if (!p) redirect("/");
  const off = deployment.computers.kind === "none";
  const c = off ? null : await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  // Ready is the door answering, not a date on the row.
  const ready = (await stateNow(c)).progress === "ready";
  return (
    // The screen less the page's own 24 of gutter, top and bottom, and the
    // whole window when framed in the room, where it has none.
    <main className="flex h-[calc(100dvh-3rem)] -mb-22 min-h-0 flex-col [html[data-framed]_&]:mb-0 [html[data-framed]_&]:h-dvh">
      {off ? (
        <ComputerWaiting
          title="Computers are off here"
          description="This deployment has no Fly token, so there is no agent to talk to."
        />
      ) : !ready ? (
        <ComputerWaiting
          polls
          title="Your computer is not ready yet"
          description="Claude Code appears here once it is."
        />
      ) : (
        <Agent />
      )}
    </main>
  );
}
