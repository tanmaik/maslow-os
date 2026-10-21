import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-1.5 py-0.5 text-caption-1-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-accent-400 text-white [a]:hover:bg-accent-500",
        secondary:
          "bg-background-tertiary-default text-text-secondary [a]:hover:bg-background-tertiary-hover",
        destructive: "bg-status-rose-background text-status-rose-text",
        outline:
          "border-border-button-default bg-background-primary-default text-text-primary shadow-xs [a]:hover:bg-background-primary-hover",
        ghost: "text-text-secondary hover:bg-background-secondary-default",
        link: "text-accent-600 underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
