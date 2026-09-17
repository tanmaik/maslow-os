"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// The split lies in two columns from this width up, as the page's own
// styles say.
const SPLIT = 640;

// How the list is walked beyond a click: the arrow keys open the record
// before or after the one open, as a mail or notes app does, unless the
// person is typing somewhere; and a double-click on a row opens that
// record's whole page. A record open beside the list by default alone is
// written into the address, so a save that moves it down the list does not
// put another record under the person's hands.
export function Walk({ hrefs, at }: { hrefs: string[]; at: number }) {
  const router = useRouter();
  const named = useSearchParams().has("open");
  useEffect(() => {
    const split = document.querySelector(".brain-split");
    if (!named && at === 0 && split && split.clientWidth >= SPLIT) {
      router.replace(hrefs[0]!, { scroll: false });
    }
  }, [named, at, hrefs, router]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
          t.closest("[role=menu],[role=listbox],[role=dialog]"))
      )
        return;
      const to = hrefs[at + (e.key === "ArrowDown" ? 1 : -1)];
      if (!to) return;
      e.preventDefault();
      router.push(to, { scroll: false });
      // The row opened is the one the keys act from now.
      document
        .querySelector<HTMLElement>(`a[href="${CSS.escape(to)}"]`)
        ?.focus();
    };
    const onDouble = (e: MouseEvent) => {
      const full = (e.target as Element | null)
        ?.closest("a[data-full]")
        ?.getAttribute("data-full");
      if (full) router.push(full);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("dblclick", onDouble);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dblclick", onDouble);
    };
  }, [hrefs, at, router]);
  return null;
}
