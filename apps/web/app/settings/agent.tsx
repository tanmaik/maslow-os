import type { Principal } from "@maslow/db/auth";

import { UsagePane } from "./usage";

// The Agent as one pane of Settings: what the Agent
// window spent this week against its cap.
export function AgentPane({ p }: { p: Principal }) {
  return (
    <div className="flex flex-col gap-4">
      <UsagePane p={p} />
    </div>
  );
}
