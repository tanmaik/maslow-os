import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The curves and clocks named in app/globals.css, so the last one on an
// element wins as any other Tailwind class does.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      ease: [{ ease: ["out-quart", "in-out-soft", "in-quad", "plain"] }],
      duration: [{ duration: ["instant", "fast", "base", "slow"] }],
    },
  },
});

// Joins class names, the later of two that conflict winning.
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
