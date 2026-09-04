"use client";

import { ChevronsUpDown, UserRound } from "lucide-react";
import { useState } from "react";

import type { deployment } from "@/lib/deployment";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

type Props = {
  where: typeof deployment.where;
  faked: string[];
  signedIn: boolean;
  me: { name: string; org: string } | null;
  orgs: {
    id: string;
    name: string;
    people: { id: string; name: string; owner: boolean }[];
  }[];
  current: string | null;
};

// A ghost button drawn on the pill's inverted surface.
const onPill =
  "text-primary-foreground/85 hover:bg-primary-foreground/12 hover:text-primary-foreground aria-expanded:bg-primary-foreground/12 aria-expanded:text-primary-foreground";

// A pill in the corner: closed, it is who you are, with a dot when anything
// is faked; open, it says where this is, what is faked, and lets you be
// someone else.
export function DevPill({ where, faked, signedIn, me, orgs, current }: Props) {
  const [open, setOpen] = useState(false);
  const fakedSaid = faked.length > 0 ? `${faked.join(", ")} faked` : null;
  return (
    <div
      className={cn(
        "bg-primary text-primary-foreground fixed right-5 bottom-5 z-50 flex h-11 items-center rounded-full shadow-lg select-none",
        "animate-in fade-in zoom-in-50 spin-in-90 duration-500 ease-[cubic-bezier(.34,1.2,.64,1)]",
      )}
    >
      <div
        className={cn(
          "grid transition-[grid-template-columns] duration-400 ease-[cubic-bezier(.19,1,.22,1)]",
          open ? "[grid-template-columns:1fr]" : "[grid-template-columns:0fr]",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-1 overflow-hidden text-xs whitespace-nowrap transition-[opacity,filter,transform] duration-500 ease-[cubic-bezier(.19,1,.22,1)]",
            open ? "pl-2 opacity-100" : "scale-50 opacity-0 blur-md",
          )}
        >
          <span className="bg-primary-foreground/12 rounded-full px-2 py-0.5 font-medium">
            {where}
          </span>
          {fakedSaid && (
            <span className="text-primary-foreground/60 px-1.5">
              {fakedSaid}
            </span>
          )}
          <Popover>
            <PopoverTrigger
              render={<Button variant="ghost" size="xs" />}
              className={cn(onPill, "rounded-full")}
            >
              {me
                ? `${me.name} · ${me.org}`
                : signedIn
                  ? "Signed in as yourself"
                  : "Signed out"}
              <ChevronsUpDown className="opacity-60" />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={12}
              className="w-64 space-y-3"
            >
              {orgs.map((o) => (
                <div key={o.id} className="space-y-1">
                  <p className="text-muted-foreground text-xs">{o.name}</p>
                  <div className="flex flex-wrap gap-1">
                    {o.people.map((u) => (
                      <form key={u.id} action="/auth/dev" method="post">
                        <input type="hidden" name="user" value={u.id} />
                        <Button
                          variant={current === u.id ? "secondary" : "ghost"}
                          size="xs"
                          type="submit"
                        >
                          {u.name}
                          {u.owner && (
                            <span className="text-muted-foreground ml-1">
                              owner
                            </span>
                          )}
                        </Button>
                      </form>
                    ))}
                  </div>
                </div>
              ))}
              {signedIn && (
                <form action="/auth/sign-out" method="post">
                  <Button variant="ghost" size="xs" type="submit">
                    Sign out
                  </Button>
                </form>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-expanded={open}
        aria-label={open ? "Close dev toolbar" : "Open dev toolbar"}
        title={open ? undefined : (fakedSaid ?? undefined)}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          onPill,
          "relative size-11 rounded-full text-sm font-medium",
        )}
      >
        {me ? initials(me.name) : <UserRound />}
        {fakedSaid && !open && (
          <span className="bg-primary-foreground ring-primary absolute top-2 right-2 size-1.5 rounded-full ring-2" />
        )}
      </Button>
    </div>
  );
}
