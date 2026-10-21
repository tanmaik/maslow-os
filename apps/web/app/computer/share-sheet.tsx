"use client";

import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Divider } from "@/components/base/divider/divider";
import { Select, SelectItem } from "@/components/base/select/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Who one shared thing reaches, as the sheet sets it whole, and at what
// level where the thing has one. Public is anyone on the internet with the
// address, which only a port can be.
export type Reach = {
  public: boolean;
  everyone: boolean;
  groupIds: string[];
  memberIds: string[];
  level: "view" | "edit";
};

// Who a shared thing can be given to.
export type Parties = {
  members: { id: string; name: string }[];
  groups: { id: string; name: string }[];
};

// The one sheet every shared thing has: a port, a file or a folder.
// Anyone on the internet where the thing can be public; everyone in the
// org, or the groups and people ticked; at view or edit where there is a
// level to choose; the link to copy. Everything ticked is sent, so
// whatever is unticked is taken away in the same act. Saving answers with
// what went wrong, or nothing.
export function ShareSheet({
  open,
  title,
  description,
  link,
  publicLink,
  parties,
  on,
  levels = false,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  link: string;
  // The bare address anyone can open, where the thing can be public; the
  // sheet offers public only when this is given.
  publicLink?: string;
  parties: Parties;
  on: Reach;
  // Whether view and edit are on offer; a port opens or is not there.
  levels?: boolean;
  onSave: (to: Reach) => Promise<string | null>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState<Reach>(on);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // What is ticked starts as what reaches now, each time the sheet opens.
  useEffect(() => {
    if (open) {
      setTo(on);
      setRefused(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const toggle = (field: "groupIds" | "memberIds", id: string, on: boolean) =>
    setTo((was) => ({
      ...was,
      [field]: on
        ? [...new Set([...was[field], id])]
        : was[field].filter((x) => x !== id),
    }));
  const save = async () => {
    setSaving(true);
    setRefused(null);
    const why = await onSave(to).catch((e: Error) => e.message);
    setSaving(false);
    if (why) setRefused(why);
    else onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(now) => !now && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate rounded-2lg bg-background-tertiary-default px-3 py-2 font-mono text-caption-1-regular text-text-secondary">
            {(to.public && publicLink) ||
              link ||
              "The link appears once it is shared."}
          </p>
          <Button
            variant="secondary"
            size="small"
            type="button"
            disabled={!link}
            leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
            onClick={() => {
              void navigator.clipboard.writeText(
                (to.public && publicLink) || link,
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto py-2">
          {publicLink !== undefined && (
            <>
              <Checkbox
                size="sm"
                isSelected={to.public}
                onChange={(on) => setTo((was) => ({ ...was, public: on }))}
              >
                Anyone on the internet with the address
              </Checkbox>
              {to.public && (
                <p className="text-caption-1-regular text-text-secondary">
                  No sign-in: whatever runs on this port must check who is
                  calling itself, and the address will be found.
                </p>
              )}
              <Divider />
            </>
          )}
          <Checkbox
            size="sm"
            isSelected={to.everyone}
            onChange={(on) => setTo((was) => ({ ...was, everyone: on }))}
          >
            Everyone in the org
          </Checkbox>
          {parties.groups.length > 0 && (
            <>
              <Divider />
              {parties.groups.map((g) => (
                <Checkbox
                  size="sm"
                  key={g.id}
                  isSelected={to.groupIds.includes(g.id)}
                  onChange={(on) => toggle("groupIds", g.id, on)}
                >
                  {g.name}
                </Checkbox>
              ))}
            </>
          )}
          {parties.members.length > 0 && (
            <>
              <Divider />
              {parties.members.map((m) => (
                <Checkbox
                  size="sm"
                  key={m.id}
                  isSelected={to.memberIds.includes(m.id)}
                  onChange={(on) => toggle("memberIds", m.id, on)}
                >
                  {m.name}
                </Checkbox>
              ))}
            </>
          )}
        </div>
        {levels && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-body-medium text-text-secondary">
              They may
            </span>
            <Select
              size="sm"
              aria-label="They may"
              selectedKey={to.level}
              onSelectionChange={(key) =>
                setTo((was) => ({
                  ...was,
                  level: key === "edit" ? "edit" : "view",
                }))
              }
              triggerClassName="w-40"
              popoverClassName="w-[var(--trigger-width)] max-w-none"
            >
              <SelectItem id="view">view</SelectItem>
              <SelectItem id="edit">edit</SelectItem>
            </Select>
          </div>
        )}
        {levels && to.everyone && to.level === "edit" && (
          <p className="text-caption-1-regular text-text-secondary">
            Everyone in the org can only view; the groups and people ticked may
            edit.
          </p>
        )}
        {refused && (
          <p className="text-caption-1-regular text-text-error-primary">
            {refused}
          </p>
        )}
        <DialogFooter>
          <DialogClose
            render={<Button variant="secondary" size="small" type="button" />}
          >
            Cancel
          </DialogClose>
          <Button size="small" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
