"use client";

import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { useState } from "react";

import { StatusDot } from "@/components/base/badges/status-dot";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Divider } from "@/components/base/divider/divider";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Row, Rows } from "@/app/settings/row";

export type Port = { port: number; name: string; ran?: string };
type Share = {
  port: number;
  subject: "everyone" | "group" | "member";
  memberId: string | null;
  groupId: string | null;
};
export type Sharing = {
  machineId: string;
  members: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  shares: Share[];
};

// What a port's row says about who has it, in the fewest words that are
// still true.
function reach(shares: Share[]): string | null {
  if (shares.length === 0) return null;
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
// address is not there for anybody else.
export function Ports({
  ports,
  sharing,
}: {
  ports: Port[];
  sharing: Sharing | null;
}) {
  // The port whose sheet is open, if any.
  const [sharingPort, setSharingPort] = useState<number | null>(null);
  if (ports.length === 0) return null;
  const on = (port: number) =>
    sharing?.shares.filter((s) => s.port === port) ?? [];
  const link = (port: number) =>
    sharing ? `/port/${sharing.machineId}/${port}` : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-body-2-medium text-text-secondary">Open ports</p>
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
                  description={p.ran || p.name}
                >
                  {said && (
                    <span className="text-body-2-regular text-text-secondary">
                      {said}
                    </span>
                  )}
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
                    />
                  }
                >
                  Open
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
      {sharing && (
        <Sheet
          port={sharingPort}
          onClose={() => setSharingPort(null)}
          sharing={sharing}
          on={sharingPort === null ? [] : on(sharingPort)}
        />
      )}
    </div>
  );
}

// Who one port reaches: everyone in the org, or the groups and people
// ticked. Everything ticked is sent, so whatever is unticked is taken away
// in the same act. There is no level to choose: the address opens for them,
// or it is not there.
function Sheet({
  port,
  on,
  sharing,
  onClose,
}: {
  port: number | null;
  on: Share[];
  sharing: Sharing;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const everyone = on.some((s) => s.subject === "everyone");
  const has = (field: "groupId" | "memberId", id: string) =>
    on.some((s) => s[field] === id);
  const link =
    port === null
      ? ""
      : `${typeof window === "undefined" ? "" : window.location.origin}/port/${sharing.machineId}/${port}`;
  return (
    <Dialog open={port !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form action="/computer/share" method="post" className="contents">
          <input type="hidden" name="port" value={port ?? ""} />
          <DialogHeader>
            <DialogTitle>Share port {port}</DialogTitle>
            <DialogDescription>
              Whoever you pick opens the link below while signed in to Maslow.
              For everybody else the address is not there at all.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate rounded-2lg bg-background-tertiary-default px-3 py-2 font-mono text-caption-1-regular text-text-secondary">
              {link}
            </p>
            <Button
              variant="secondary"
              size="small"
              type="button"
              leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
              onClick={() => {
                void navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto py-2">
            <Checkbox size="sm" name="everyone" defaultSelected={everyone}>
              Everyone in the org
            </Checkbox>
            {sharing.groups.length > 0 && (
              <>
                <Divider />
                {sharing.groups.map((g) => (
                  <Checkbox
                    size="sm"
                    key={g.id}
                    name="group"
                    value={g.id}
                    defaultSelected={has("groupId", g.id)}
                  >
                    {g.name}
                  </Checkbox>
                ))}
              </>
            )}
            {sharing.members.length > 0 && (
              <>
                <Divider />
                {sharing.members.map((m) => (
                  <Checkbox
                    size="sm"
                    key={m.id}
                    name="member"
                    value={m.id}
                    defaultSelected={has("memberId", m.id)}
                  >
                    {m.name}
                  </Checkbox>
                ))}
              </>
            )}
          </div>
          <DialogFooter>
            <DialogClose
              render={<Button variant="secondary" size="small" type="button" />}
            >
              Cancel
            </DialogClose>
            <Button type="submit" size="small">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
