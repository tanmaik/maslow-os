import { usePathname, useSearchParams } from "next/navigation";

// The address of the view being read, as a page opened from it comes back
// to.
export function useHere(): string {
  const pathname = usePathname();
  const s = useSearchParams().toString();
  return s ? `${pathname}?${s}` : pathname;
}
