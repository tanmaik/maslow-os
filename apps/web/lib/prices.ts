// What each vendor charges us, in dollars, in the unit we measure. Every
// figure is the vendor's list price; the meter multiplies, nothing else.
// A month is 730 hours, as the vendors' monthly prices assume.
const MONTH = 730 * 3600;

export const PRICES = {
  // Tigris standard storage, per byte-second: $0.02 per GB a month on its
  // list, read 2026-09-04; requests and egress are not metered yet.
  bucket: 0.02 / MONTH / 1e9,
  // Neon storage, per byte-second: $0.35 per GB a month, for the rows a
  // person's brain holds. Compute is shared and not yet apportioned.
  brain: 0.35 / MONTH / 1e9,
  // Voyage voyage-4-lite, per token: $0.02 per million on its list, read
  // 2026-09-05. The allowance Voyage gives us is ours, not the person's,
  // and is reconciled against its bill like every other discount.
  vectors: 0.02 / 1e6,
  // Composio, per tool call: $0.0003 on its list, read 2026-09-05; the
  // calls its free plan includes are ours the same way.
  actions: 0.0003,
};
