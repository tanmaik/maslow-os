import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The rows of one part of a pane, a hairline between each.
export function Rows({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex w-full flex-col", className)}>{children}</div>
  );
}

// One setting: what it is on the left, the control that changes it on the
// right.
export function Row({
  label,
  description,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-10 w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-1.5 last:border-b-0",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-0 flex-col">
        <div className="text-sm text-foreground">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}
