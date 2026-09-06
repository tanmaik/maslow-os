import type { Principal } from "@placeholder/db/auth";
import type { MachineSession } from "@placeholder/db/agents";

import { deployment } from "./deployment.ts";
import { link } from "./disk.ts";
import { offered } from "./models.ts";

// The agent's socket on the person's machine, by a signed link.
export const acpUrl = async (p: Principal, sessionId: string) => {
  const id = sessionId.toLowerCase();
  return (await link(p, "acp", id, `?session=${id}`)).replace(/^http/, "ws");
};

// Everything a session on a machine is configured with, in one answer: the
// model, where models are reached, the tools it may call, and whether the
// agent is faked here. The one place that changes when any of those does.
export type Bootstrap = {
  fake: boolean;
  model: string;
  gateway: string;
  mcpServers: {
    name: string;
    type: "http";
    url: string;
    headers: { name: string; value: string }[];
  }[];
  // The last event number the app holds; the machine numbers on from it.
  seq: number;
};

// The person's brain is a tool the harness is given, reached at the app's
// door as the machine, naming the conversation.
export function bootstrapFor(
  s: MachineSession,
  machine: { machineId: string; secret: string },
): Bootstrap {
  const models = offered();
  const c = deployment.computers;
  const app = c.kind === "fly" ? new URL(c.report).origin : null;
  return {
    fake: models.length === 0 && !deployment.production,
    model: models.some((m) => m.id === s.model)
      ? s.model
      : (models[0]?.id ?? s.model),
    gateway: app ? `${app}/model` : "",
    mcpServers: app
      ? [
          {
            name: "brain",
            type: "http",
            url: `${app}/mcp`,
            headers: [
              {
                name: "Authorization",
                value: `Bearer ${machine.machineId}.${machine.secret}`,
              },
              { name: "x-agent-session", value: s.id },
            ],
          },
        ]
      : [],
    seq: s.seq,
  };
}
