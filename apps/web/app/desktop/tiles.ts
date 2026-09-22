import type { Card, Kind } from "@maslow/db/desktops";

// What the room draws, in words a browser can hold without the database,
// and the rules of the desktop, the same on the server that keeps one and in
// the browser that draws one.
export type { Card, Kind };

// A port on somebody's computer, to open as a window, wearing the face of
// whatever serves there.
export type Port = {
  title: string;
  href: string;
  face?: string;
  // Opens in a browser tab of its own and not as a window: its page
  // refuses to be framed, or its owner said so.
  tab?: true;
};

// Something that can be opened: what kind it is, what it is called, where
// it is, and the size it opens at.
export type Dragged = {
  kind: Card["kind"];
  title: string;
  href: string;
  box: Box;
};

// A name for a new window, unlike any other on the desktop.
export const fresh = (): string => Math.random().toString(36).slice(2, 10);

// How big a window is, as shares of the desktop.
export type Box = { w: number; h: number };

// The smallest a window may be made: enough for a title bar and a few
// lines.
export const MIN: Box = { w: 0.14, h: 0.16 };

// A number held between two others.
const between = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

// A window held inside the desktop at no less than the smallest size.
export function clamp<T extends Box & { x: number; y: number }>(c: T): T {
  const w = between(c.w, MIN.w, 1);
  const h = between(c.h, MIN.h, 1);
  return {
    ...c,
    w,
    h,
    x: between(c.x, 0, 1 - w),
    y: between(c.y, 0, 1 - h),
  };
}

// Whether a number is a share: between nothing and the whole.
export const share = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
