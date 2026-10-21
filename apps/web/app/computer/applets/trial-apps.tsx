"use client";

import { Row, Rows } from "@/app/settings/row";
import { StatusDot } from "@/components/base/badges/status-dot";
import { Button } from "@/components/base/buttons/button";
import type { DemoApp } from "@/lib/trial-computer";

// The apps on a trial's pretend computer, as Applets lists published
// ports: listening, each with its port, what it is for, and a way to open
// it as a window on the desktop.
export function TrialApps({ apps }: { apps: DemoApp[] }) {
  const open = (port: number) => {
    const to = window.parent === window ? window : window.parent;
    to.postMessage({ maslow: "open", port }, location.origin);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-caption-1-medium text-text-secondary">
        Published as apps
      </p>
      <Rows>
        {apps.map((a) => (
          <Row
            key={a.port}
            label={
              <span className="flex items-center gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <StatusDot color="green" />
                </span>
                <span>{a.title}</span>
                <span className="text-caption-1-regular text-text-tertiary tabular-nums">
                  :{a.port}
                </span>
              </span>
            }
            description={a.about}
          >
            <Button size="xs" variant="secondary" onClick={() => open(a.port)}>
              Open
            </Button>
          </Row>
        ))}
      </Rows>
    </div>
  );
}
