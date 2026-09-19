"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PublishSheet } from "@/app/computer/publish-sheet";
import { ShareSheet, type Reach } from "@/app/computer/share-sheet";
import { Row, Rows } from "@/app/settings/row";
import { StatusDot } from "@/components/base/badges/status-dot";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type Port = {
  port: number;
  name: string;
  ran?: string;
  face?: string;
};
// A port published as an app: its name and the face it wears.
export type Published = { port: number; name: string; icon: string | null };
type Share = {
  port: number;
  subject: "everyone" | "group" | "member" | "public";
  memberId: string | null;
  groupId: string | null;
};
export type Sharing = {
  machineId: string;
  // The domain the machine's ports are reached under.
  domain: string;
  members: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  shares: Share[];
};

// What a port's row says about who has it, in the fewest words that are
// still true.
function reach(shares: Share[]): string | null {
  if (shares.length === 0) return null;
  if (shares.some((s) => s.subject === "public")) return "public";
  if (shares.some((s) => s.subject === "everyone")) return "everyone";
  const groups = shares.filter((s) => s.subject === "group").length;
  const people = shares.filter((s) => s.subject === "member").length;
  const said = [];
  if (groups > 0) said.push(groups === 1 ? "1 group" : `${groups} groups`);
  if (people > 0) said.push(people === 1 ? "1 person" : `${people} people`);
  return said.join(", ");
}

// The ports listening inside the person's computer. Each is an address of
// its own, opened here by its owner, and given away with Share, on the row
// or on a right-click. A port nobody was given is theirs alone: the
// address is not there for anybody else. A public one is there for
// anyone, with no sign-in.
export function Ports({
  ports,
  sharing,
  published,
}: {
  ports: Port[];
  sharing: Sharing | null;
  published: Published[];
}) {
  // The port whose sheet is open, if any.
  const [sharingPort, setSharingPort] = useState<number | null>(null);
  const [publishingPort, setPublishingPort] = useState<number | null>(null);
  const appOf = (port: number) => published.find((a) => a.port === port);
  const router = useRouter();
  if (ports.length === 0) return null;
  const on = (port: number) =>
    sharing?.shares.filter((s) => s.port === port) ?? [];
  const link = (port: number) =>
    sharing ? `/port/${sharing.machineId}/${port}` : null;
  // In a window on the desktop a port opens as a window there, never as a
  // new tab, which on a phone's home-screen app would leave the app.
  const openHere = (e: React.MouseEvent, port: number) => {
    if (window.self === window.top) return;
    e.preventDefault();
    window.parent.postMessage({ maslow: "open", port }, location.origin);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-caption-1-medium text-text-secondary">
        Open ports
      </p>
      <Rows>
        {ports.map((p) => {
          const said = reach(on(p.port));
          return (
            <ContextMenu key={p.port}>
              <ContextMenuTrigger render={<div />}>
                <Row
                  label={
                    <span className="flex items-center gap-2.5">
                      <StatusDot color="green" />
                      <span className="tabular-nums">{p.port}</span>
                    </span>
                  }
                  description={appOf(p.port)?.name ?? (p.ran || p.name)}
                >
                  {said && (
                    <span className="text-caption-1-regular text-text-secondary">
                      {said}
                    </span>
                  )}
                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={!sharing}
                    onClick={() => setPublishingPort(p.port)}
                  >
                    {appOf(p.port) ? "App…" : "Publish…"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={!sharing}
                    onClick={() => setSharingPort(p.port)}
                  >
                    Share
                  </Button>
                  <ButtonLink
                    variant="secondary"
                    size="xs"
                    href={`/computer/open?port=${p.port}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => openHere(e, p.port)}
                  >
                    Open
                  </ButtonLink>
                </Row>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  render={
                    <a
                      href={`/computer/open?port=${p.port}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => openHere(e, p.port)}
                    />
                  }
                >
                  Open
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!sharing}
                  onClick={() => setPublishingPort(p.port)}
                >
                  {appOf(p.port) ? "As an app…" : "Publish…"}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!sharing}
                  onClick={() => setSharingPort(p.port)}
                >
                  Share…
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!sharing}
                  onClick={() => {
                    const to = link(p.port);
                    if (to)
                      void navigator.clipboard.writeText(
                        new URL(to, window.location.origin).toString(),
                      );
                  }}
                >
                  Copy link
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </Rows>
      {sharing && publishingPort !== null && (
        <PublishSheet
          port={publishingPort}
          name={
            appOf(publishingPort)?.name ??
            ports.find((p) => p.port === publishingPort)?.name ??
            `Port ${publishingPort}`
          }
          face={
            appOf(publishingPort)?.icon ??
            ports.find((p) => p.port === publishingPort)?.face
          }
          published={!!appOf(publishingPort)}
          onClose={() => setPublishingPort(null)}
        />
      )}
      {sharing && (
        <ShareSheet
          open={sharingPort !== null}
          title={`Share port ${sharingPort ?? ""}`}
          description="Whoever you pick opens the link below while signed in to Maslow. For everybody else the address is not there at all, unless you make it public."
          link={
            sharingPort === null
              ? ""
              : `${window.location.origin}/port/${sharing.machineId}/${sharingPort}`
          }
          publicLink={
            sharingPort === null
              ? ""
              : `https://${sharingPort}-${sharing.machineId}.${sharing.domain}/`
          }
          parties={sharing}
          on={reachOf(sharingPort === null ? [] : on(sharingPort))}
          onSave={async (to) => {
            const form = new FormData();
            form.set("port", String(sharingPort));
            if (to.public) form.set("public", "on");
            if (to.everyone) form.set("everyone", "on");
            for (const g of to.groupIds) form.append("group", g);
            for (const m of to.memberIds) form.append("member", m);
            const res = await fetch("/computer/share", {
              method: "POST",
              body: form,
            });
            if (!res.ok) return (await res.text()) || "That was not saved.";
            router.refresh();
            return null;
          }}
          onClose={() => setSharingPort(null)}
        />
      )}
    </div>
  );
}

// The rows a port's shares are, as the sheet takes them.
const reachOf = (on: Share[]): Reach => ({
  public: on.some((s) => s.subject === "public"),
  everyone: on.some((s) => s.subject === "everyone"),
  groupIds: on.flatMap((s) => (s.groupId ? [s.groupId] : [])),
  memberIds: on.flatMap((s) => (s.memberId ? [s.memberId] : [])),
  level: "view",
});
