"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "group/toggle inline-flex cursor-pointer items-center justify-center gap-1 rounded-md text-body-medium whitespace-nowrap text-text-secondary transition-[background-color,color,box-shadow] duration-base ease-plain outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-segmented-control-selected-background aria-pressed:text-text-primary aria-pressed:shadow-2xs data-[state=on]:bg-segmented-control-selected-background data-[state=on]:text-text-primary data-[state=on]:shadow-2xs [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-border-button-default bg-background-primary-default shadow-xs hover:border-border-button-hover hover:bg-background-primary-hover aria-pressed:bg-background-primary-active data-[state=on]:bg-background-primary-active",
      },
      size: {
        default:
          "h-7 min-w-7 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-6 min-w-6 rounded-md px-2 text-body-2-medium has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
