"use client";

import type { ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// One choice out of a few, as a form field: the value goes to the form
// under `name`, and the trigger shows the label of what is chosen.
export function Choose({
  options,
  name,
  value,
  defaultValue,
  onValueChange,
  defaultOpen,
  onOpenChange,
  placeholder,
  required,
  disabled,
  size = "default",
  className,
  "aria-label": label,
}: {
  options: readonly (readonly [value: string, label: ReactNode])[];
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v) => v != null && onValueChange?.(v as string)}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      required={required}
      disabled={disabled}
      items={options.map(([v, l]) => ({ value: v, label: l }))}
    >
      <SelectTrigger size={size} aria-label={label} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
