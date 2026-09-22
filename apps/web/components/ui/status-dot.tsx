import * as React from "react";

import { cn } from "@/lib/utils";

const TONES = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  primary: "bg-primary",
  muted: "bg-muted-foreground",
};

// A small dot that says what state something is in.
function StatusDot({
  tone = "muted",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: keyof typeof TONES }) {
  return (
    <span
      data-slot="status-dot"
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export { StatusDot };
