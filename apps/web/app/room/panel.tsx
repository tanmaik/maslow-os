"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// A window's bar has room for the panel's own controls: after the name,
// or, for one that stands for the panel as a whole, before it, right
// after the lights. A panel that puts them inside InBar has them drawn in
// the bar when it is in a window, and where they are, in the shape `as`
// gives them, when it is a page of its own.
//
// A phone's bar holds a way back, the name and one control that opens the
// rest as a sheet: the controls go there, and the few a panel is looked at
// through — a path, an address — go to a strip of their own under the bar.
const Bar = createContext<{
  controls: HTMLElement | null;
  leading: HTMLElement | null;
  strip: HTMLElement | null;
  phone: boolean;
  // A panel with something to ask before its window closes leaves the
  // question here; the room asks it and stops when the answer is no.
  beforeClose?: (ask: (() => Promise<boolean>) | null) => void;
} | null>(null);

export const BarSlot = Bar.Provider;

// Whether this panel is in a window on a phone, where its controls fold
// into a strip and a sheet rather than lying along the bar.
export const useFolded = () => useContext(Bar)?.phone ?? false;

export function InBar({
  children,
  as,
  leading = false,
  phone = "overflow",
}: {
  children: ReactNode;
  as?: (controls: ReactNode) => ReactNode;
  leading?: boolean;
  // Where these controls go on a phone: the sheet the bar opens, or the
  // strip under it.
  phone?: "strip" | "overflow";
}) {
  const bar = useContext(Bar);
  const slot = bar
    ? bar.phone
      ? phone === "strip"
        ? (bar.strip ?? bar.controls)
        : bar.controls
      : leading
        ? bar.leading
        : bar.controls
    : null;
  if (slot)
    return createPortal(
      // The controls are the panel's, not a handle on the window: a press
      // on them neither drags nor fills the screen.
      <span
        className="contents"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {children}
      </span>,
      slot,
    );
  // In a window on a phone the controls live in the sheet the bar opens,
  // and are drawn only while it is open: the bar has no room for them.
  if (bar?.phone) return null;
  return <>{as ? as(children) : children}</>;
}

// Holds this panel's window open until its own question is answered: an
// edit not saved, and nothing else the room could know about.
export function useBeforeClose(ask: () => Promise<boolean>) {
  const bar = useContext(Bar);
  const latest = useRef(ask);
  latest.current = ask;
  const register = bar?.beforeClose;
  useEffect(() => {
    if (!register) return;
    register(() => latest.current());
    return () => register(null);
  }, [register]);
}
