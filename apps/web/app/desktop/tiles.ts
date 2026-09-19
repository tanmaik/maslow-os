import type { Card, SavedDesktop, Kind, Screen } from "@maslow/db/desktops";

// What the room draws, in words a browser can hold without the database,
// and the rules of the desktop, the same on the server that keeps one and in
// the browser that draws one.
export type { Card, SavedDesktop, Kind, Screen };

// A port on somebody's computer, to open as a window, wearing the face of
// whatever serves there.
export type Port = {
  title: string;
  href: string;
  face?: string;
  // A port never published: opened when asked for by number, and in no
  // dock and no command bar.
  bare?: true;
};

// A name for a new window, unlike any other on the desktop.
export const fresh = (): string => Math.random().toString(36).slice(2, 10);

// How big a window is, as shares of the desktop.
export type Box = { w: number; h: number };

// The smallest a window may be made: enough for a title bar and a few
// lines.
export const MIN: Box = { w: 0.14, h: 0.16 };

// A number held between two others.
export const between = (n: number, lo: number, hi: number) =>
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

// Where a new window goes when nobody said: a little down and to the
// right of the last, like a desktop of paper, back towards the corner when
// it would run off, half a step over so it does not land on the first.
// Only the windows on the desktop count: one minimized pushes nothing.
export function cascade(cards: Card[], box: Box): { x: number; y: number } {
  // A display is wider than it is tall, so the same share is a longer
  // step across than down; these two are about the same distance.
  const across = 0.02;
  const down = 0.03;
  const n = cards.filter((c) => !c.minimized && !c.pinned).length;
  const x = 0.04 + across * n;
  const y = 0.04 + down * n;
  if (x + box.w > 1 || y + box.h > 1) {
    const round = Math.floor(n / 6);
    const at = (n % 6) + (round % 2 ? 0.5 : 0);
    return { x: 0.04 + across * at, y: 0.04 + down * at };
  }
  return { x, y };
}

// A size in pixels, so it means the same on every display; either side of
// it may be left unsaid.
export type Cap = { w?: number; h?: number };

// One side of a window, held between the least and the most its surface
// is worth being, and kept in the middle of the place it was given, so a
// held window that fills the screen sits in the screen's middle. Neither
// bound may ask for more than the desktop has.
function held(
  at: number,
  size: number,
  desktop: number,
  min = 0,
  max = Infinity,
) {
  const lo = Math.min(1, min / desktop);
  const hi = Math.max(lo, Math.min(1, max / desktop));
  const want = between(size, lo, hi);
  return { at: between(at + (size - want) / 2, 0, 1 - want), size: want };
}

// A window's place on the desktop, held to the sizes its surface is worth.
// Shares in, shares out.
export function fit<T extends Box & { x: number; y: number }>(
  c: T,
  desktop: Box,
  bounds: { min?: Cap; max?: Cap } | undefined,
): T {
  if (!bounds || desktop.w <= 0 || desktop.h <= 0) return c;
  const across = held(c.x, c.w, desktop.w, bounds.min?.w, bounds.max?.w);
  const down = held(c.y, c.h, desktop.h, bounds.min?.h, bounds.max?.h);
  return { ...c, x: across.at, y: down.at, w: across.size, h: down.size };
}

// Whether a number is a share: between nothing and the whole.
export const share = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
