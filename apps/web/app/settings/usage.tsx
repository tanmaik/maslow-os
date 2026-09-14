import { asOrg } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { computerOf } from "@maslow/db/computers";
import { orgOf } from "@maslow/db/settings";

import { AiProfileShell } from "@/components/application/ai-profile/ai-profile-shell";
import { Notification } from "@/components/base/notification/notification";
import { usageOf } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { initials } from "@/lib/initials";
import { regionName } from "@/lib/region";
import { storage } from "@/lib/storage";

// What this person has spent on models, in dollars: this week against the
// ceiling that is theirs, the days behind it, and the models that took it.
// A deployment that mints no model keys has nothing to show and says so.
export async function UsagePane({ p }: { p: Principal }) {
  const [usage, { members }, computer] = await Promise.all([
    usageOf(p),
    orgOf(p),
    deployment.computers.kind === "none"
      ? null
      : asOrg(p.orgId, (q) => computerOf(q, p.userId)),
  ]);
  if (!usage)
    return (
      <Notification
        status="neutral"
        dismissible={false}
        title="Model keys are off here"
        description="This deployment mints none, so Claude Code on a computer runs on credentials of your own and there is nothing of ours to meter."
      />
    );
  const me = members.find((m) => m.id === p.userId);
  return (
    <AiProfileShell
      name={me?.name ?? "You"}
      avatar={{
        src: me?.avatarKey ? storage.url(me.avatarKey) : undefined,
        initials: initials(me?.name ?? "You"),
      }}
      where={
        computer
          ? `Your computer in ${regionName(computer.region)}`
          : "No computer yet"
      }
      usage={usage}
    />
  );
}
