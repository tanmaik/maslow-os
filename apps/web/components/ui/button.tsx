import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// BoardUI's button, on shadcn's base: the primary is the accent gradient,
// the outline is the bordered white one, a press darkens one step and
// never scales; sizes are BoardUI's medium, small and xs.
const buttonVariants = cva(
  "group/button button-press-motion inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 font-sans text-body-medium whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-invalid:ring-2 aria-invalid:ring-border-error-default [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-button-primary text-text-white shadow-xs disabled:text-button-primary-disabled-foreground disabled:shadow-none",
        outline:
          "border border-border-button-default bg-background-primary-default text-text-primary shadow-xs hover:border-border-button-hover hover:bg-background-primary-hover active:border-border-button-active active:bg-background-primary-active aria-expanded:bg-background-primary-hover disabled:bg-background-primary-disabled disabled:text-text-tertiary disabled:shadow-none",
        secondary:
          "bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover active:bg-background-tertiary-default aria-expanded:bg-background-secondary-hover disabled:text-text-tertiary",
        ghost:
          "bg-button-ghost-background text-button-ghost-foreground hover:bg-button-ghost-hover active:bg-button-ghost-active aria-expanded:bg-button-ghost-hover disabled:bg-button-ghost-disabled disabled:text-button-ghost-disabled-foreground",
        plain:
          "text-text-primary hover:bg-background-primary-hover active:bg-background-primary-active aria-expanded:bg-background-primary-hover disabled:text-text-tertiary",
        destructive:
          "bg-button-danger text-text-white shadow-xs disabled:text-foreground-disabled-danger disabled:shadow-none aria-disabled:text-foreground-disabled-danger aria-disabled:shadow-none",
        link: "text-accent-600 underline-offset-4 hover:underline active:text-accent-700",
      },
      size: {
        default: "h-9 rounded-2lg px-3",
        lg: "h-9 rounded-2lg px-3",
        sm: "h-8 rounded-lg px-2.5",
        xs: "h-6 rounded-sm px-2 text-caption-1-semibold [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-9 rounded-2lg [&_svg:not([class*='size-'])]:size-5",
        "icon-lg": "size-9 rounded-2lg [&_svg:not([class*='size-'])]:size-5",
        "icon-sm":
          "size-8 rounded-lg [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  disabled,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
