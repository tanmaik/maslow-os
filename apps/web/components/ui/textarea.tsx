import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-2lg bg-background-tertiary-default text-text-primary ring-2 ring-transparent ring-inset transition-[background-color,box-shadow,color] duration-150 placeholder:text-text-placeholder hover:ring-border-button-hover focus-visible:ring-border-button-active disabled:cursor-not-allowed disabled:bg-input-disabled-background disabled:text-input-disabled-text aria-invalid:bg-background-tertiary-error aria-invalid:ring-border-error-default px-3 py-2 text-body-regular outline-none",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
