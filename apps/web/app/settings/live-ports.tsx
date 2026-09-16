"use client";

import { useStats } from "@/app/computer/numbers";
import { Ports, type Sharing } from "@/app/computer/ports";

// The ports listening on the person's computer right now, read from its
// door as the Computer pane reads its numbers, with the sharing of each.
export function LivePorts({ sharing }: { sharing: Sharing | null }) {
  const { now } = useStats();
  return <Ports ports={now?.ports ?? []} sharing={sharing} />;
}
