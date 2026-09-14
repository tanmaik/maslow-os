"use client";

import type { ReactNode } from "react";

import { buttonStyles } from "@/components/base/buttons/button";
import { EagerLink } from "@/components/eager-link";
import { cx } from "@/utils/cx";

// A link wearing a button's face. The styles live in a client module, so a
// page read on the server reaches them through a component, never by
// spreading the recipe itself.
export function LinkButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <EagerLink
      href={href}
      className={cx(
        buttonStyles.base,
        buttonStyles.size.small,
        buttonStyles.variant.secondary,
      )}
    >
      <span className={buttonStyles.label.small}>{children}</span>
    </EagerLink>
  );
}
