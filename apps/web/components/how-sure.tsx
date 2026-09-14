"use client";

import { useState } from "react";

import { Slider } from "@/components/base/slider/slider";

// A percentage picked on a slider, read out above its thumb, posted as one
// input. Given no value, it posts nothing until it is moved.
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
  return (
    <div id={id}>
      <input
        type="hidden"
        name={name}
        value={touched || defaultValue !== null ? value : ""}
      />
      <Slider
        label="How sure"
        thumbLabel="How sure"
        minValue={0}
        maxValue={100}
        step={5}
        value={value}
        formatValue={(v) => `${v}%`}
        onChange={(v) => {
          setTouched(true);
          setValue(v);
        }}
      />
    </div>
  );
}
