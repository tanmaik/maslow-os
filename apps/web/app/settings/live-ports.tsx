"use client";

import { useStats } from "@/app/computer/numbers";
import { Ports, type Published, type Sharing } from "@/app/computer/ports";

// The ports listening on the person's computer right now, read from its
// door as the Computer pane reads its numbers, with the sharing of each
// and which are published as apps.
export function LivePorts({
  sharing,
  published,
}: {
  sharing: Sharing | null;
  published: Published[];
}) {
  const { now } = useStats();
  return (
    <Ports ports={now?.ports ?? []} sharing={sharing} published={published} />
  );
}
