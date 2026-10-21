import type { SharedPort } from "@maslow/db/computers";

import { Row, Rows } from "@/app/settings/row";
import { ButtonLink } from "@/components/base/buttons/button";

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

// The ports others opened to this person, each a browser tab a click away.
export function Shared({ ports }: { ports: SharedPort[] }) {
  if (ports.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-caption-1-medium text-text-secondary">
        Shared with you
      </p>
      <Rows>
        {ports.map((s) => (
          <Row
            key={`${s.machineId}:${s.port}`}
            label={s.name ?? `${s.owner}'s port ${s.port}`}
            description={s.name ? `${s.owner} · ${reach(s.via)}` : reach(s.via)}
          >
            <ButtonLink
              variant="secondary"
              size="xs"
              href={`/port/${s.machineId}/${s.port}`}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </ButtonLink>
          </Row>
        ))}
      </Rows>
    </div>
  );
}
