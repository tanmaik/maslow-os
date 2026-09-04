"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

// A percentage picked on a slider, read out beside it, posted as one input.
// Given no value, it posts nothing until it is moved.
export function HowSure({
  id,
  name,
  defaultValue = 100,
}: {
  id: string;
  name: string;
  defaultValue?: number | null;
}) {
  const [value, setValue] = useState(defaultValue ?? 100);
  const [touched, setTouched] = useState(false);
  const labelId = `${id}-label`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label id={labelId} htmlFor={id}>
          How sure
        </Label>
        <span className="text-muted-foreground text-sm tabular-nums">
          {value}%
        </span>
      </div>
      <input
        type="hidden"
        name={name}
        value={touched || defaultValue !== null ? value : ""}
      />
      <Slider
        id={id}
        aria-labelledby={labelId}
        min={0}
        max={100}
        step={5}
        value={[value]}
        onValueChange={(v) => {
          setTouched(true);
          setValue(Array.isArray(v) ? (v[0] ?? 0) : v);
        }}
      />
    </div>
  );
}
