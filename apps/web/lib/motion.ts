// The motion of the product, in the one place it is decided: the springs
// and tweens motion/react drives, twins of the curves and clocks in
// globals.css. No component writes a stiffness of its own.

/** A stack settling after one of its rows left. Tight, never bouncy. */
export const SNAP = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.7,
} as const;

/** The clocks, for motion/react: arriving, settling, leaving, and the
 * window's flight to its icon and back. */
export const FAST = { duration: 0.15, ease: [0.22, 1, 0.36, 1] } as const;
export const BASE = { duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;
export const LEAVE = { duration: 0.15, ease: [0.55, 0, 0.9, 0.35] } as const;
