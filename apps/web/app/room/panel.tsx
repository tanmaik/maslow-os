"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A window's bar has room for the panel's own controls. A panel that puts
// them inside InBar has them drawn in the bar when it is in a window, and
// where they are, in the shape `as` gives them, when it is a page of its
// own.
const Bar = createContext<HTMLElement | null>(null);

export const BarSlot = Bar.Provider;

export function InBar({
  children,
  as,
}: {
  children: ReactNode;
  as?: (controls: ReactNode) => ReactNode;
}) {
  const slot = useContext(Bar);
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
  return <>{as ? as(children) : children}</>;
}
