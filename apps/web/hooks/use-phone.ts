"use client";

import { useEffect, useState } from "react";

// Whether this is a phone, held either way: a screen narrower than a
// laptop's, or a touch-driven one turned on its side, which a tablet is
// not. The same rule the stylesheet uses, so the page and its styles
// never disagree about what they are on.
const PHONE = "(max-width: 639px), ((pointer: coarse) and (max-height: 500px))";

export function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const q = matchMedia(PHONE);
    const read = () => setPhone(q.matches);
    read();
    q.addEventListener("change", read);
    return () => q.removeEventListener("change", read);
  }, []);
  return phone;
}
