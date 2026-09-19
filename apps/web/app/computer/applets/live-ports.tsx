"use client";

import { useStats } from "@/app/computer/numbers";
import {
  Ports,
  type Published,
  type Sharing,
} from "@/app/computer/applets/ports";

// The ports listening on the person's computer right now, read from its
// door as the Computer pane reads its numbers, with the sharing of each
// and which are published as apps; and what to say while there are none.
export function LivePorts({
  sharing,
  published,
}: {
  sharing: Sharing | null;
  published: Published[];
}) {
  const { now } = useStats();
  const ports = now?.ports ?? [];
  if (now && ports.length === 0)
    return (
      <div className="flex flex-col gap-1 px-3 py-10 text-center">
        <p className="text-headline-medium text-text-primary">
          Nothing is listening
        </p>
        <p className="text-body-regular text-text-secondary">
          A server you or your agent starts shows up here. Publish one and it is
          an app in your dock.
        </p>
      </div>
    );
  return <Ports ports={ports} sharing={sharing} published={published} />;
}
