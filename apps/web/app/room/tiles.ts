import type { Card, Desktop, Kind, Screen } from "@maslow/db/desktops";

// What the room draws, in words a browser can hold without the database,
// and the rules of the desk, the same on the server that keeps one and in
// the browser that draws one.
export type { Card, Desktop, Kind, Screen };

// A port a person may place: their own, or one opened to them.
export type Port = { title: string; href: string };

// A name for a new window, unlike any other on the desk.
export const fresh = (): string => Math.random().toString(36).slice(2, 10);

// How big a window is, as shares of the desk.
export type Box = { w: number; h: number };

// The smallest a window may be made: enough for a title bar and a few
// lines.
export const MIN: Box = { w: 0.14, h: 0.16 };

const clamp01 = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

// A window held inside the desk at no less than the smallest size.
export function clamp(c: Card): Card {
  const w = clamp01(c.w, MIN.w, 1);
  const h = clamp01(c.h, MIN.h, 1);
  return {
    ...c,
    w,
    h,
    x: clamp01(c.x, 0, 1 - w),
    y: clamp01(c.y, 0, 1 - h),
  };
}

// Where a new window goes when nobody said: a little down and to the
// right of the last, like a desk of paper, back to the corner when it
// would run off.
export function cascade(cards: Card[], box: Box): { x: number; y: number } {
  const step = 0.03;
  const n = cards.length;
  const x = 0.04 + step * n;
  const y = 0.04 + step * n;
  if (x + box.w > 1 || y + box.h > 1)
    return { x: 0.04 + step * (n % 6), y: 0.04 + step * (n % 6) };
  return { x, y };
}

// Whether a number is a share: between nothing and the whole.
export const share = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
