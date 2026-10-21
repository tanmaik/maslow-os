import type { Principal } from "@maslow/db/auth";

import { AiProfileShell } from "@/components/application/ai-profile/ai-profile-shell";
import { Notification } from "@/components/base/notification/notification";
import { usageOf } from "@/lib/computer";

// What this person has spent on models, in dollars: this week against the
// ceiling that is theirs, the days behind it, and the models that took it.
// A deployment that mints no model keys has nothing to show and says so.
export async function UsagePane({ p }: { p: Principal }) {
  const usage = await usageOf(p);
  if (!usage)
    return (
      <Notification
        status="neutral"
        dismissible={false}
        title="Model keys are off here"
        description="This deployment mints none, so the agent on a computer runs on credentials of your own and there is nothing of ours to meter."
      />
    );
  return <AiProfileShell usage={usage} />;
}
