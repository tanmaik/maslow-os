import type { ComponentType, ReactNode } from "react";

import { EagerLink } from "@/components/eager-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A link wearing a button's face, with words or a mark alone.
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
    "data-icon"?: string;
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
      className={cn(
        buttonVariants({
          variant: "outline",
          size: iconOnly ? "icon-sm" : "sm",
        }),
        className,
      )}
      {...props}
    >
      {Leading && (
        <Leading
          data-icon={iconOnly ? undefined : "inline-start"}
          aria-hidden
        />
      )}
      {!iconOnly && children}
    </EagerLink>
  );
}
