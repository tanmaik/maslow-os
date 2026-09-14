"use client";

import { useEffect, useState } from "react";
import {
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
} from "react-aria-components";

import { ACCENT, ACCENTS, type Accent } from "@/components/look";
import { cx } from "@/utils/cx";

// The colour the product spends on what a person should look at, chosen
// by them and kept on this device: eight discs, the chosen one ringed.
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
    <AriaRadioGroup
      aria-label="Accent colour"
      value={accent}
      onChange={(v) => {
        if (v in ACCENTS) pick(v as Accent);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      {(Object.keys(ACCENTS) as Accent[]).map((name) => (
        <AriaRadio
          key={name}
          value={name}
          aria-label={name}
          className={(state) =>
            cx(
              "size-7 shrink-0 cursor-pointer rounded-full transition-[box-shadow,filter] duration-fast ease-out-quart",
              "ring-offset-2 ring-offset-background-primary-default",
              // Chosen is the ink of the page; focused is the focus ring,
              // one step further out, so the two never mean each other.
              state.isSelected && "ring-2 ring-text-primary",
              state.isFocusVisible &&
                "outline-2 outline-offset-[6px] outline-border-focus-ring",
              state.isPressed && "brightness-95",
            )
          }
          style={{
            background: `oklch(0.66 ${ACCENTS[name].chroma} ${ACCENTS[name].hue})`,
          }}
        />
      ))}
    </AriaRadioGroup>
  );
}
