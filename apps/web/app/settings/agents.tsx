import type { Agent } from "@maslow/db/auth";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";

import { Row, Rows } from "./row";
import { Said } from "./said";
import type { Told } from "./told";
import { on } from "./when";

// The agents the signed-in person let into their brain, and a way to end
// each one's access.
export function Agents({ agents, said }: { agents: Agent[]; said: Told }) {
  return (
    <div id="agents" className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Connect one by adding this site&apos;s <code>/mcp</code> as an MCP
        server.
      </p>
      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing connected.</p>
      ) : (
        <Rows>
          {agents.map((a) => (
            <Row
              key={a.id}
              label={
                <span className="flex items-center gap-2.5">
                  <StatusDot tone="success" />
                  {a.client}
                </span>
              }
              description={`Since ${on(a.createdAt)} · ${a.id.slice(0, 6)}`}
            >
              <form action="/settings/agents" method="post">
                <input type="hidden" name="session" value={a.id} />
                <Button variant="outline" size="sm" type="submit">
                  Disconnect
                </Button>
              </form>
            </Row>
          ))}
        </Rows>
      )}
      <Said {...said} />
    </div>
  );
}
