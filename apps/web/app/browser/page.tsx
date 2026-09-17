import { asOrg } from "@maslow/db";
import { computerOf } from "@maslow/db/computers";
import { redirect } from "next/navigation";

import { LiveBrowser } from "@/app/browser/live";
import { ComputerWaiting } from "@/components/computer-waiting";
import { stateNow } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// The person's computer's browser, the one Claude Code drives, live and
// in their hands.
export default async function BrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { url } = await searchParams;
  const off = deployment.computers.kind === "none";
  const c = off ? null : await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  // Ready is the door answering, not a date on the row.
  const ready = (await stateNow(c)).progress === "ready";
  return (
    // The same shape the terminal takes: the screen less its gutters, and
    // the whole window when framed in the room.
    <main className="flex h-[calc(100dvh-3rem)] -mb-22 min-h-0 flex-col gap-4 [html[data-framed]_&]:mb-0 [html[data-framed]_&]:h-dvh">
      <h1 className="page-title text-title-3-medium text-text-primary">
        Browser
      </h1>
      {off ? (
        <ComputerWaiting
          title="Computers are off here"
          description="This deployment has no Fly token, so there is no browser to show."
        />
      ) : !ready ? (
        <ComputerWaiting
          polls
          title="Your computer is not ready yet"
          description="Its browser appears here once it is."
        />
      ) : (
        <LiveBrowser
          href={url ? `/browser?url=${encodeURIComponent(url)}` : undefined}
        />
      )}
    </main>
  );
}
