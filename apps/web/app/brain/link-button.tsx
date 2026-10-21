"use client";

import type { ComponentType, ReactNode } from "react";

import { buttonStyles } from "@/components/base/buttons/button";
import { EagerLink } from "@/components/eager-link";
import { cx } from "@/utils/cx";

// A link wearing a button's face, with words or a mark alone. The styles
// live in a client module, so a page read on the server reaches them
// through a component, never by spreading the recipe itself.
export function LinkButton({
  href,
  leadingIcon: Leading,
  iconOnly = false,
  className,
  children,
  ...props
}: {
  href: string;
  leadingIcon?: ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  iconOnly?: boolean;
  className?: string;
  "aria-label"?: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <EagerLink
      href={href}
      className={cx(
        buttonStyles.base,
        buttonStyles.size.small,
        buttonStyles.variant.secondary,
        iconOnly && buttonStyles.iconOnlySize.small,
        className,
      )}
      {...props}
    >
      {Leading && <Leading className={buttonStyles.icon.small} aria-hidden />}
      {!iconOnly && children !== undefined && (
        <span className={buttonStyles.label.small}>{children}</span>
      )}
    </EagerLink>
  );
}
