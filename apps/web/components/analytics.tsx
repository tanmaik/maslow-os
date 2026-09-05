"use client";

// The full build carries replay, error tracking, dead clicks, heatmaps,
// web vitals and surveys inside our own bundle, so nothing is fetched from
// PostHog's hosts that a browser's blocker could drop.
import posthog from "posthog-js/dist/module.full.no-external";
import { useEffect } from "react";

import type { Analytics as Config, deployment } from "@/lib/deployment";

type Props = {
  config: Config;
  where: typeof deployment.where;
  // The person signed in, their role, and the org they are acting in, or
  // nobody.
  person: { id: string; orgId: string; role: string } | null;
};

// Reports to PostHog: every page seen, click, error and replay, tagged with
// which deployment this is, as the person signed in, in the org they are in.
// A person is an id and a role, never a name or an email, and a replay shows
// the shape of a page and not a word on it. Renders nothing.
export function Analytics({ config, where, person }: Props) {
  const id = person?.id ?? null;
  const orgId = person?.orgId ?? null;
  const role = person?.role ?? null;
  useEffect(() => {
    if (config.kind !== "posthog") return;
    if (!posthog.__loaded)
      posthog.init(config.key, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        defaults: "2026-08-30",
        capture_exceptions: true,
        capture_dead_clicks: true,
        capture_heatmaps: true,
        session_recording: { maskAllInputs: true, maskTextSelector: "*" },
      });
    posthog.register({ deployment: where });
    if (id && orgId) {
      if (posthog._isIdentified() && posthog.get_distinct_id() !== id)
        posthog.reset();
      posthog.identify(id, { role });
      posthog.group("org", orgId);
    } else if (posthog._isIdentified()) posthog.reset();
  }, [config, where, id, orgId, role]);
  return null;
}
