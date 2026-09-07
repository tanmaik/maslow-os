"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

// A link whose page, rows and all, starts loading the moment the pointer,
// finger or focus reaches it, so the click that follows finds it ready.
export function EagerLink({ href, ...props }: ComponentProps<typeof Link>) {
  const router = useRouter();
  // The router's own prefetch stops at the page's shape; "full" asks for
  // the rows too. The kind is a string the router's type names by enum.
  const load = () =>
    router.prefetch(typeof href === "string" ? href : "", {
      kind: "full",
    } as Parameters<typeof router.prefetch>[1]);
  return (
    <Link
      href={href}
      onMouseEnter={load}
      onFocus={load}
      onTouchStart={load}
      {...props}
    />
  );
}
