// What each vendor charges us, in dollars, in the unit we measure. Every
// figure is the vendor's list price; the meter multiplies, nothing else.
// A month is 730 hours, as the vendors' monthly prices assume.
export const MONTH = 730 * 3600;

export const PRICES = {
  // Fly machine, per second while started: shared-cpu-1x with 1 GB is
  // $0.00000228 a second on Fly's list, read 2026-09-04.
  compute: { "shared-cpu-1x:1024": 0.00000228 } as Record<string, number>,
  // Fly keeps a stopped machine's root filesystem for $0.15 per GB a month;
  // ours is well under a gigabyte and Fly bills the size it is, so one
  // gigabyte is the ceiling until the sweep reads the real size.
  rootfs: 0.15 / MONTH,
  // Fly volume, per GB-second: $0.15 per GB a month.
  disk: 0.15 / MONTH,
  // Tigris standard storage, per byte-second: $0.02 per GB a month on its
  // list, read 2026-09-04; requests and egress are not metered yet.
  bucket: 0.02 / MONTH / 1e9,
  // Neon storage, per byte-second: $0.35 per GB a month, for the rows a
  // person's brain holds. Compute is shared and not yet apportioned.
  brain: 0.35 / MONTH / 1e9,
};
