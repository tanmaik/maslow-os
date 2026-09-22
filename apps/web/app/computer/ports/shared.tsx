import type { SharedPort } from "@maslow/db/computers";
import Link from "next/link";

import { appHref } from "@/app/desktop/apps";
import { Row, Rows } from "@/app/settings/row";
import { Button } from "@/components/ui/button";

// How a port reaches the reader, in words: given to them by name, through
// a group they are in, or to everyone in the org.
const reach = (via: string[]) =>
  via
    .map((v) =>
      v === "you"
        ? "shared with you"
        : v === "everyone"
          ? "shared with everyone"
          : `through ${v.replace(/^group:/, "")}`,
    )
    .join(", ");

// The ports others opened to this person, each opened as the sidebar
// opens it: filling the screen, or in a tab where its owner said so.
export function Shared({ ports }: { ports: SharedPort[] }) {
  if (ports.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        Shared with you
      </p>
      <Rows>
        {ports.map((s) => (
          <Row
            key={`${s.machineId}:${s.port}`}
            label={s.name ?? `${s.owner}'s port ${s.port}`}
            description={s.name ? `${s.owner} · ${reach(s.via)}` : reach(s.via)}
          >
            <Button
              variant="outline"
              size="xs"
              nativeButton={false}
              render={
                s.tab ? (
                  <a
                    href={`/port/${s.machineId}/${s.port}`}
                    target="_blank"
                    rel="noreferrer"
                  />
                ) : (
                  <Link
                    href={appHref({
                      href: `/port/${s.machineId}/${s.port}`,
                      title: s.name ?? `${s.owner}'s port ${s.port}`,
                    })}
                  />
                )
              }
            >
              Open
            </Button>
          </Row>
        ))}
      </Rows>
    </div>
  );
}
