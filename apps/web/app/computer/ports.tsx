"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

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
// its own, opened here by its owner, and given away by right-clicking it.
// A port nobody was given is theirs alone: the address is not there for
// anybody else.
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
    <div className="space-y-1">
      <p className="text-sm font-medium">Open ports</p>
      <ul className="text-sm">
        {ports.map((p) => {
          const said = reach(on(p.port));
          return (
            <ContextMenu key={p.port}>
              <ContextMenuTrigger
                render={
                  <li className="hover:bg-accent -mx-2 flex min-w-0 items-baseline gap-2 rounded-md px-2 py-0.5" />
                }
              >
                <a
                  className="shrink-0 underline underline-offset-4"
                  href={`/computer/open?port=${p.port}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.port}
                </a>
                <span className="text-muted-foreground min-w-0 flex-1 truncate">
                  {p.ran || p.name}
                </span>
                {said && (
                  <span className="text-muted-foreground shrink-0">{said}</span>
                )}
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
      </ul>
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
          <p className="bg-muted text-muted-foreground truncate rounded-md px-2 py-1 font-mono text-xs">
            {link}
          </p>
          <div className="max-h-72 space-y-3 overflow-y-auto py-2">
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox name="everyone" defaultChecked={everyone} />
              Everyone in the org
            </Label>
            {sharing.groups.length > 0 && (
              <>
                <Separator />
                {sharing.groups.map((g) => (
                  <Label
                    key={g.id}
                    className="flex items-center gap-2 font-normal"
                  >
                    <Checkbox
                      name="group"
                      value={g.id}
                      defaultChecked={has("groupId", g.id)}
                    />
                    {g.name}
                  </Label>
                ))}
              </>
            )}
            {sharing.members.length > 0 && (
              <>
                <Separator />
                {sharing.members.map((m) => (
                  <Label
                    key={m.id}
                    className="flex items-center gap-2 font-normal"
                  >
                    <Checkbox
                      name="member"
                      value={m.id}
                      defaultChecked={has("memberId", m.id)}
                    />
                    {m.name}
                  </Label>
                ))}
              </>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
