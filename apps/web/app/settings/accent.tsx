"use client";

import { useEffect, useState } from "react";

import { ACCENT, ACCENTS, type Accent } from "@/components/look";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// The colour the product spends on what a person should look at, chosen
// by them and kept on this device: eight discs, the chosen one dotted.
export function AccentPicker() {
  const [accent, setAccent] = useState<Accent>("orange");
  useEffect(() => {
    const kept = localStorage.getItem(ACCENT);
    if (kept && kept in ACCENTS) setAccent(kept as Accent);
  }, []);
  const pick = (to: Accent) => {
    setAccent(to);
    localStorage.setItem(ACCENT, to);
    document.documentElement.dataset.accent = to;
  };
  return (
    <RadioGroup
      aria-label="Accent colour"
      value={accent}
      onValueChange={(v) => {
        if (typeof v === "string" && v in ACCENTS) pick(v as Accent);
      }}
      className="flex w-auto flex-wrap items-center gap-2"
    >
      {(Object.keys(ACCENTS) as Accent[]).map((name) => (
        <RadioGroupItem
          key={name}
          value={name}
          aria-label={name}
          className="size-5 cursor-pointer border-transparent data-checked:border-transparent"
          style={{
            background: `oklch(0.66 ${ACCENTS[name].chroma} ${ACCENTS[name].hue})`,
          }}
        />
      ))}
    </RadioGroup>
  );
}
