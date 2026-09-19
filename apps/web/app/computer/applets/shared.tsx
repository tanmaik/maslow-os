"use client";

import type { SharedPort } from "@maslow/db/computers";

import { Row, Rows } from "@/app/settings/row";
import { ButtonLink } from "@/components/base/buttons/button";

// How a port reaches the reader, in words: given to them by name, through
// a group they are in, to everyone in the org, or to anyone at all.
const reach = (via: string[]) =>
  via
    .map((v) =>
      v === "you"
        ? "shared with you"
        : v === "everyone"
          ? "shared with everyone"
          : v === "public"
            ? "public"
            : `through ${v.replace(/^group:/, "")}`,
    )
    .join(", ");

// The ports others opened to this person, each a window a click away: in a
// window on the desktop it opens as a window there, never as a new tab,
// which on a phone's home-screen app would leave the app.
export function Shared({ ports }: { ports: SharedPort[] }) {
  if (ports.length === 0) return null;
  const openHere = (e: React.MouseEvent, s: SharedPort) => {
    if (window.self === window.top) return;
    e.preventDefault();
    window.parent.postMessage(
      { maslow: "open", port: s.port, machine: s.machineId },
      location.origin,
    );
  };
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
              onClick={(e) => openHere(e, s)}
            >
              Open
            </ButtonLink>
          </Row>
        ))}
      </Rows>
    </div>
  );
}
