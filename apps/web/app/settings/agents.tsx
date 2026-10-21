import type { Agent } from "@maslow/db/auth";

import { StatusDot } from "@/components/base/badges/status-dot";
import { Button } from "@/components/base/buttons/button";

import { Row, Rows } from "./row";
import { Said } from "./said";
import { Section } from "./section";
import type { Told } from "./told";
import { on } from "./when";

// The agents the signed-in person let into their brain, and a way to end
// each one's access.
export function Agents({ agents, said }: { agents: Agent[]; said: Told }) {
  return (
    <Section
      id="agents"
      title="Agents"
      description={
        <>
          Connect one by adding this site&apos;s <code>/mcp</code> as an MCP
          server.
        </>
      }
    >
      {agents.length === 0 ? (
        <p className="text-body-regular text-text-secondary">
          Nothing connected.
        </p>
      ) : (
        <Rows>
          {agents.map((a) => (
            <Row
              key={a.id}
              label={
                <span className="flex items-center gap-2.5">
                  <StatusDot color="green" />
                  {a.client}
                </span>
              }
              description={`Since ${on(a.createdAt)} · ${a.id.slice(0, 6)}`}
            >
              <form action="/settings/agents" method="post">
                <input type="hidden" name="session" value={a.id} />
                <Button variant="secondary" size="small" type="submit">
                  Disconnect
                </Button>
              </form>
            </Row>
          ))}
        </Rows>
      )}
      <Said {...said} />
    </Section>
  );
}
