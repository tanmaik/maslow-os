import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-2lg bg-background-tertiary-default text-text-primary ring-2 ring-transparent ring-inset transition-[background-color,box-shadow,color] duration-150 placeholder:text-text-placeholder hover:ring-border-button-hover focus-visible:ring-border-button-active disabled:cursor-not-allowed disabled:bg-input-disabled-background disabled:text-input-disabled-text aria-invalid:bg-background-tertiary-error aria-invalid:ring-border-error-default px-3 py-1 text-body-regular outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body-medium file:text-text-primary",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
