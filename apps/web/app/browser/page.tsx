import { asOrg } from "@maslow/db";
import { computerOf } from "@maslow/db/computers";
import { redirect } from "next/navigation";

import { LiveBrowser } from "@/app/browser/live";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// The person's computer's browser, the one Claude Code drives, live and
// in their hands.
export default async function BrowserPage() {
  const p = await principal();
  if (!p) redirect("/");
  const off = deployment.computers.kind === "none";
  const c = off ? null : await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  const ready = c?.readyAt !== null && c?.readyAt !== undefined;
  return (
    <main className="flex h-full flex-col gap-4">
      <h1 className="page-title text-2xl font-semibold">Browser</h1>
      {off ? (
        <Alert>
          <AlertTitle>Computers are off here</AlertTitle>
          <AlertDescription>
            This deployment has no Fly token, so there is no browser to show.
          </AlertDescription>
        </Alert>
      ) : !ready ? (
        <Alert>
          <AlertTitle>Your computer is not ready yet</AlertTitle>
          <AlertDescription>
            Its browser appears here once it is. The Computer page shows it
            coming up.
          </AlertDescription>
        </Alert>
      ) : (
        <LiveBrowser />
      )}
    </main>
  );
}
