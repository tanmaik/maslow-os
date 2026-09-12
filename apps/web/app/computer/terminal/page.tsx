import { asOrg } from "@maslow/db";
import { computerOf } from "@maslow/db/computers";
import { redirect } from "next/navigation";

import { Terminal } from "@/app/computer/terminal/terminal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  const ready = c?.readyAt !== null && c?.readyAt !== undefined;
  return (
    // The whole screen less the page's own margins, and the whole window
    // when framed in the room, where it has none.
    <main className="flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col gap-4 [html[data-framed]_&]:h-dvh">
      <h1 className="page-title text-2xl font-semibold">Terminal</h1>
      {off ? (
        <Alert>
          <AlertTitle>Computers are off here</AlertTitle>
          <AlertDescription>
            This deployment has no Fly token, so there is no terminal to show.
          </AlertDescription>
        </Alert>
      ) : !ready ? (
        <Alert>
          <AlertTitle>Your computer is not ready yet</AlertTitle>
          <AlertDescription>
            Its terminal appears here once it is. The Computer page shows it
            coming up.
          </AlertDescription>
        </Alert>
      ) : (
        <Terminal />
      )}
    </main>
  );
}
