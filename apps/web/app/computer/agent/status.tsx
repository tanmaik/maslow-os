"use client";

import { useEffect, useState } from "react";

import type { Context, Mode } from "@/app/computer/agent/acp";
import { AgentLimitsCard } from "@/components/application/agent-limits/agent-limits-card";
import { ContextRing } from "@/components/application/ai-chat/ai-chat-composer";
import {
  PermissionMenu,
  type ComposerPermission,
} from "@/components/application/composer-panel/composer-panel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Usage } from "@/lib/computer";
import { dayOf, dollars } from "@/lib/dollars";

// How the agent acts, in the composer's words and in the protocol's: the
// menu offers auto, manual, plan and bypass; Claude Code names the same
// four acceptEdits, default, plan and bypassPermissions.
const PERMISSION_OF: Record<string, ComposerPermission> = {
  default: "manual",
  acceptEdits: "auto",
  plan: "plan",
  bypassPermissions: "bypass",
};
const MODE_OF: Record<ComposerPermission, string> = {
  manual: "default",
  auto: "acceptEdits",
  plan: "plan",
  bypass: "bypassPermissions",
};

// The week's spend against the cap, read from `/usage` once a minute.
function useUsage(): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let live = true;
    const read = async () => {
      const res = await fetch("/usage", { cache: "no-store" }).catch(
        () => null,
      );
      if (!live) return;
      setUsage(res?.ok ? ((await res.json()) as Usage) : null);
    };
    void read();
    const every = setInterval(read, 60_000);
    return () => {
      live = false;
      clearInterval(every);
    };
  }, []);
  return usage;
}

// The row under the composer: how the agent acts on the left; on the
// right, what the week has cost and how full the conversation is, the
// ring opening onto the whole budget card.
export function Status({
  mode,
  modes,
  onMode,
  context,
}: {
  mode: string | null;
  modes: Mode[];
  onMode: (id: string) => void;
  context: Context | null;
}) {
  const usage = useUsage();
  const used = context ? context.segments.reduce((n, s) => n + s.tokens, 0) : 0;
  const pct = context
    ? Math.min(100, Math.round((used / context.max) * 100))
    : null;
  const reached = usage ? usage.spentUsd >= usage.capUsd : false;
  return (
    <div className="flex h-[26px] w-full items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {modes.length > 0 && (
          <PermissionMenu
            value={(mode && PERMISSION_OF[mode]) || "manual"}
            onChange={(p) => {
              const to = MODE_OF[p];
              if (modes.some((m) => m.id === to)) onMode(to);
            }}
          />
        )}
      </div>
      <Popover>
        <PopoverTrigger
          aria-label="This week's spend and how full the conversation is"
          className="flex cursor-pointer items-center gap-2 rounded-[40px] bg-background-tertiary-default py-1 pr-2 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          {usage && (
            <span
              className={
                reached
                  ? "text-body-2-medium whitespace-nowrap text-text-error-primary"
                  : "text-body-2-medium whitespace-nowrap text-text-secondary"
              }
            >
              {reached
                ? "Weekly limit reached"
                : `${dollars(usage.spentUsd)} of ${dollars(usage.capUsd)}`}
            </span>
          )}
          {pct !== null && (
            <span className="flex items-center gap-1">
              <ContextRing pct={pct} />
              <span className="text-body-2-medium whitespace-nowrap text-text-secondary">
                {pct}%
              </span>
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] p-0">
          <AgentLimitsCard
            plan="Maslow"
            planHref="/settings?pane=claude"
            context={context ?? { max: 1_000_000, segments: [] }}
            limits={
              usage
                ? [
                    {
                      label: "Weekly · Maslow's key",
                      used:
                        usage.capUsd === 0
                          ? 0
                          : Math.min(1, usage.spentUsd / usage.capUsd),
                      resets: `Resets ${dayOf(usage.resetsAt)}`,
                    },
                  ]
                : []
            }
            className="border-0 shadow-none"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
