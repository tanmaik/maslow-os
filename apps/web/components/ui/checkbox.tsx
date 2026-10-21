"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-checkbox-default bg-background-primary-default shadow-xs transition-[background-color,border-color,box-shadow] duration-150 outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 hover:border-border-checkbox-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-border-error-default data-checked:border-transparent data-checked:bg-linear-to-b data-checked:from-accent-500 data-checked:to-accent-600 data-checked:text-white data-checked:shadow-checkbox-selected data-indeterminate:border-transparent data-indeterminate:bg-linear-to-b data-indeterminate:from-accent-500 data-indeterminate:to-accent-600 data-indeterminate:text-white data-indeterminate:shadow-checkbox-selected",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
