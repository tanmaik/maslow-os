"use client";

import { useState } from "react";

import { NewOrgDialog } from "@/components/new-org";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/initials";

// You, in the corner: your picture or your initials, and under it the
// other orgs you are in, a new org, and the way out.
export function You({
  name,
  email,
  picture,
  others,
}: {
  name: string;
  email: string;
  picture: string | null;
  others: { userId: string; orgName: string }[];
}) {
  const [makingOrg, setMakingOrg] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="shadow-float pointer-events-auto rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          render={<button type="button" />}
        >
          <Avatar className="size-9 after:hidden">
            {picture && <AvatarImage src={picture} alt="" />}
            <AvatarFallback className="bg-[oklch(0.32_0.02_55)] text-xs font-semibold text-[oklch(0.9_0.02_70)]">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="sr-only">{name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-64 p-1.5"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-foreground text-sm font-medium">
                {name}
              </span>
              <span className="font-normal">{email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {others.length > 0 && (
            <form action="/auth/switch" method="post">
              {others.map((m) => (
                <DropdownMenuItem
                  key={m.userId}
                  className="w-full"
                  nativeButton
                  render={
                    <button type="submit" name="membership" value={m.userId} />
                  }
                >
                  Switch to {m.orgName}
                </DropdownMenuItem>
              ))}
            </form>
          )}
          <DropdownMenuItem onClick={() => setMakingOrg(true)}>
            New org…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <form action="/auth/sign-out" method="post">
            <DropdownMenuItem
              className="w-full"
              nativeButton
              render={<button type="submit" />}
            >
              Sign out, {name}
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewOrgDialog open={makingOrg} onOpenChange={setMakingOrg} />
    </>
  );
}
