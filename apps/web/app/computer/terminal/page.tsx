import { asOrg } from "@maslow/db";
import { computerOf } from "@maslow/db/computers";
import { redirect } from "next/navigation";

import { Terminal } from "@/app/computer/terminal/terminal";
import { ComputerWaiting } from "@/components/computer-waiting";
import { stateNow } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// The person's computer's terminal: a plain shell, the same session every
// time it is opened, from any screen, with Claude Code the word `claude`
// away.
export default async function TerminalPage() {
  const p = await principal();
  if (!p) redirect("/");
  const off = deployment.computers.kind === "none";
  const c = off ? null : await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  // Ready is the door answering, not a date on the row.
  const ready = (await stateNow(c)).progress === "ready";
  return (
    // The screen less the page's own 24 of gutter, top and bottom, and the
    // whole window when framed in the room, where it has none. The negative
    // margin gives back the 112 the layout keeps under every page for
    // chrome this one does not have; it goes when that padding does.
    <main className="flex h-[calc(100dvh-3rem)] -mb-22 min-h-0 flex-col gap-4 [html[data-framed]_&]:mb-0 [html[data-framed]_&]:h-dvh">
      <h1 className="page-title text-title-3-medium text-text-primary">
        Terminal
      </h1>
      {off ? (
        <ComputerWaiting
          title="Computers are off here"
          description="This deployment has no cloud for computers, so there is no terminal to show."
        />
      ) : !ready ? (
        <ComputerWaiting
          polls
          title="Your computer is not ready yet"
          description="Its terminal appears here once it is."
        />
      ) : (
        <Terminal />
      )}
    </main>
  );
}
