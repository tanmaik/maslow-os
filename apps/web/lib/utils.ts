import { clsx, type ClassValue } from "clsx";

import { cx } from "@/utils/cx";

// shadcn's class merger, on BoardUI's: it knows the composite type styles,
// so a title beside a colour keeps its size.
export function cn(...inputs: ClassValue[]) {
  return cx(clsx(inputs));
}
