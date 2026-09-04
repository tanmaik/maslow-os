"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { kindHref } from "./format";
import { KindIcon } from "./kind-icon";

type View = { href: string; label: string; kind?: string; group?: 2 };

// The brain's views: every record, one view per kind, and the org's
// vocabulary, the log and the file door. The current one is marked.
export function BrainNav({ kinds }: { kinds: string[] }) {
  const pathname = usePathname();
  const kind = useSearchParams().get("kind") ?? "";
  const current =
    pathname === "/brain" ? kindHref(kind || undefined) : pathname;
  const views: View[] = [
    { href: "/brain", label: "Records" },
    ...kinds.map((k) => ({ href: kindHref(k), label: k, kind: k })),
    { href: "/brain/vocabulary", label: "Vocabulary", group: 2 },
    { href: "/brain/activity", label: "Activity", group: 2 },
    { href: "/brain/transfer", label: "Export & import", group: 2 },
  ];
  return (
    <nav className="flex flex-wrap gap-1 md:flex-col">
      {views.map((v, i) => (
        <span key={v.href} className="contents">
          {v.group && !views[i - 1]?.group && (
            <Separator className="my-2 hidden md:block" />
          )}
          <Button
            variant={v.href === current ? "secondary" : "ghost"}
            size="sm"
            className={`shrink-0 justify-start ${v.kind ? "md:ml-3" : ""}`}
            nativeButton={false}
            render={<a href={v.href} />}
          >
            {v.kind && <KindIcon kind={v.kind} />}
            {v.label}
          </Button>
        </span>
      ))}
    </nav>
  );
}
