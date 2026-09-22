"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useStats } from "@/app/computer/numbers";
import { Row, Rows } from "@/app/settings/row";
import {
  Ports,
  type Published,
  type Sharing,
} from "@/app/computer/ports/ports";
import { StatusDot } from "@/components/ui/status-dot";

// The apps and shared ports found not listening: kept as they were for ten
// minutes in case they come back, and forgotten after, which the page
// asks after again each minute so the row goes when the app does.
function Stopped({ ports }: { ports: { port: number; name: string }[] }) {
  const router = useRouter();
  const any = ports.length > 0;
  useEffect(() => {
    if (!any) return;
    const again = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(again);
  }, [any, router]);
  if (!any) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Stopped</p>
      <Rows>
        {ports.map((p) => (
          <Row
            key={p.port}
            label={
              <span className="flex items-center gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <StatusDot tone="warning" />
                </span>
                <span className="tabular-nums">{p.port}</span>
              </span>
            }
            description={`${p.name} · not listening. Back within ten minutes, it goes on as it was; after that it is forgotten.`}
          />
        ))}
      </Rows>
    </div>
  );
}

// The ports listening on the person's computer right now, read from its
// door as the Computer pane reads its numbers, with the sharing of each
// and which are published as apps; the ones that matter and have stopped;
// and what to say while there are none.
export function LivePorts({
  sharing,
  published,
}: {
  sharing: Sharing | null;
  published: Published[];
}) {
  const { now } = useStats();
  const ports = now?.ports ?? [];
  const up = new Set(ports.map((p) => p.port));
  const matter = new Map<number, string>();
  for (const x of sharing?.shares ?? []) matter.set(x.port, `Port ${x.port}`);
  for (const a of published) matter.set(a.port, a.name);
  const stopped = now
    ? [...matter]
        .filter(([port]) => !up.has(port))
        .map(([port, name]) => ({ port, name }))
        .sort((a, b) => a.port - b.port)
    : [];
  if (now && ports.length === 0 && stopped.length === 0)
    return (
      <div className="flex flex-col gap-1 px-3 py-10 text-center">
        <p className="text-sm font-medium text-foreground">
          Nothing is listening
        </p>
        <p className="text-sm text-muted-foreground">
          A server started on your computer shows up here. Make one an app and
          it is in your sidebar.
        </p>
      </div>
    );
  return (
    <>
      <Ports ports={ports} sharing={sharing} published={published} />
      <Stopped ports={stopped} />
    </>
  );
}
