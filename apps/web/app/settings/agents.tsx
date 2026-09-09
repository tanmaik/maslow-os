import type { Agent } from "@maslow/db/auth";

import { Button } from "@/components/ui/button";

import { Item } from "@/components/ui/item";
import { Section } from "./section";

// The agents the signed-in person let into their brain, and a way to end
// each one's access.
export function Agents({
  orgName,
  agents,
  said,
}: {
  orgName: string;
  agents: Agent[];
  said: string | null;
}) {
  return (
    <Section
      id="agents"
      title="Agents in your brain"
      description={
        <>
          Each reads and writes as you, in {orgName}, until you end it. Connect
          another by adding this site&apos;s <code>/mcp</code> as an MCP server.
        </>
      }
    >
      {agents.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing connected.</p>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => (
            <Item variant="muted" className="rounded-[10px]" key={a.id}>
              <span className="bg-chart-1 size-2 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium">{a.client}</p>
                <p className="text-muted-foreground text-xs">
                  since {a.createdAt.toISOString().slice(0, 10)}
                </p>
              </div>
              <form action="/settings/agents" method="post">
                <input type="hidden" name="session" value={a.id} />
                <Button
                  variant="ghost"
                  size="xs"
                  type="submit"
                  className="text-muted-foreground"
                >
                  End
                </Button>
              </form>
            </Item>
          ))}
        </div>
      )}
      {said && <p className="text-sm">{said}</p>}
    </Section>
  );
}
