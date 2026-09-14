"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-[background-color,box-shadow] duration-200 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2 data-[size=default]:h-6 data-[size=default]:w-[42px] data-[size=sm]:h-4 data-[size=sm]:w-7 data-checked:bg-linear-to-b data-checked:from-accent-500 data-checked:to-accent-600 data-[size=default]:data-checked:shadow-[inset_0_1.5px_0_0_rgb(255_255_255/0.25),inset_0_0_0_0.75px_var(--color-accent-500)] data-[size=sm]:data-checked:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),inset_0_0_0_0.5px_var(--color-accent-500)] data-unchecked:bg-background-tertiary-default data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute block rounded-full bg-linear-to-b from-white to-neutral-100 shadow-[0_1px_2px_0_rgb(0_0_0/0.15)] transition-transform duration-200 ease-out group-data-[size=default]/switch:top-[3px] group-data-[size=default]/switch:left-[3px] group-data-[size=default]/switch:size-[18px] group-data-[size=sm]/switch:top-0.5 group-data-[size=sm]/switch:left-0.5 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[18px] group-data-[size=sm]/switch:data-checked:translate-x-3 group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
