"use client";

import { RiExpandDiagonalLine } from "@remixicon/react";

import { LinkButton } from "../../link-button";

// The way from a record read beside the list to the record as a whole
// page: one mark, since the page is the same record with more room.
export function Expand({ href }: { href: string }) {
  return (
    <LinkButton
      href={href}
      leadingIcon={RiExpandDiagonalLine}
      iconOnly
      aria-label="Open in full page"
      title="Open in full page"
      className="shrink-0"
    />
  );
}
