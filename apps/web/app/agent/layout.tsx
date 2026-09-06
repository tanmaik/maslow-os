import { sessionsOf } from "@placeholder/db/agents";
import { computersAllowed } from "@placeholder/db/computers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AgentSidebar } from "@/components/agent/sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { deployment } from "@/lib/deployment";
import { modelById } from "@/lib/models";
import { principal } from "@/lib/session";

// The agent, laid out as a harness lays out a chat: every conversation down
// the left, the one being had in a window on the right.
export default async function AgentLayout({
  children,
}: {
  children: ReactNode;
}) {
  const p = await principal();
  if (!p) redirect("/");
  if (deployment.computers.kind === "none")
    return <Note>Computers are not set up on this deployment.</Note>;
  if (!(await computersAllowed(p)))
    return (
      <Note>
        Computers are off for this org. An owner can turn them on in{" "}
        <a href="/settings" className="underline">
          Settings
        </a>
        .
      </Note>
    );
  const sessions = await sessionsOf(p);
  return (
    <SidebarProvider className="bg-sidebar fixed inset-x-0 top-8 bottom-0 min-h-0">
      <AgentSidebar
        sessions={sessions.map((s) => ({
          id: s.id,
          title: s.title,
          model: modelById(s.model)?.label ?? s.model,
          state: s.state,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          settledAt: s.settledAt?.toISOString() ?? null,
          // Finished after the person last looked, or never looked at all
          // while a turn has finished: unread.
          unread:
            s.finishedAt !== null &&
            (s.seenAt === null || s.finishedAt > s.seenAt),
        }))}
      />
      <SidebarInset className="min-h-0 overflow-hidden">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Agent</h1>
      <p className="text-muted-foreground mt-2">{children}</p>
    </main>
  );
}
