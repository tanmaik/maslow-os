import type { Principal } from "@maslow/db/auth";

import { Row, Rows } from "./row";
import { UsagePane } from "./usage";
import { usageOf } from "@/lib/computer";
import { deployment } from "@/lib/deployment";

// Claude Code on the person's computer, as one pane. Two run there and
// they never share credentials: the Agent window is Maslow's, on the key
// we minted, GLM 5.3 Flash and nothing else, and this pane shows what it
// spent this week against the cap; `claude` in a Terminal is the person's
// own, on their own Claude account, signed into inside Claude Code, and
// nothing of it passes through us.
export async function ClaudePane({ p }: { p: Principal }) {
  const usage = deployment.computers.kind === "none" ? null : await usageOf(p);
  return (
    <div className="flex flex-col gap-4">
      {usage && (
        <Rows>
          <Row
            label="The Agent window"
            description={`Runs on Maslow's key: GLM 5.3 Flash, nothing else, to $${usage.capUsd} a week.`}
          />
          <Row
            label="Claude Code in a Terminal"
            description="Your own, on your own Claude account. Sign in inside it: claude auth login."
          />
        </Rows>
      )}
      <UsagePane p={p} />
    </div>
  );
}
