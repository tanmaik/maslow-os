"use client";

import { usePathname } from "next/navigation";

import { EagerLink } from "@/components/eager-link";
import { Button } from "@/components/ui/button";

const TABS = [
  ["Team", "/"],
  ["Brain", "/brain"],
  ["Computer", "/computer"],
  ["Settings", "/settings"],
] as const;

// The four places in the house, as one pill; the one you are in is filled.
export function Tabs() {
  const pathname = usePathname();
  const current =
    pathname === "/"
      ? "/"
      : TABS.find(([, href]) => href !== "/" && pathname.startsWith(href))?.[1];
  return (
    <nav className="shadow-float pointer-events-auto flex h-10 max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-card px-1">
      {TABS.map(([name, href]) => (
        <Button
          key={href}
          variant={href === current ? "secondary" : "ghost"}
          className={`h-8 px-3.5 text-[13px] ${href === current ? "" : "text-muted-foreground"}`}
          nativeButton={false}
          render={
            <EagerLink
              href={href}
              aria-current={href === current ? "page" : undefined}
            />
          }
        >
          {name}
        </Button>
      ))}
    </nav>
  );
}
