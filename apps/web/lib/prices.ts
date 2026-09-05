// What each vendor charges us, in dollars, in the unit we measure. Every
// figure is the vendor's list price; the meter multiplies, nothing else.
// A month is 730 hours, as the vendors' monthly prices assume.
export const MONTH = 730 * 3600;

// The sizes a computer climbs, smallest first: a machine that has outgrown
// one is made again at the next, and the last is as far as it goes. Each
// is a Fly preset: CPU kind and count, then memory in MB.
export const LADDER = [
  "shared-cpu-1x:1024",
  "shared-cpu-2x:2048",
  "shared-cpu-4x:4096",
  "performance-2x:8192",
];

export const PRICES = {
  // Fly machine, per second while started, each rung of the ladder on
  // Fly's list, read 2026-09-04.
  compute: {
    "shared-cpu-1x:1024": 0.00000228,
    "shared-cpu-2x:2048": 0.00000456,
    "shared-cpu-4x:4096": 0.00000913,
    "performance-2x:8192": 0.00003286,
  } as Record<string, number>,
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

// A size taken apart: "shared-cpu-2x:2048" is two shared CPUs and 2048 MB,
// "performance-2x:8192" two performance CPUs and 8192 MB.
export function parseSize(size: string) {
  const m = /^(shared|performance)(?:-cpu)?-(\d+)x:(\d+)$/.exec(size);
  if (!m) throw new Error(`${size} is not a machine size`);
  return { kind: m[1]!, cpus: Number(m[2]), memoryMb: Number(m[3]) };
}

// A size as a person would say it: "1 shared CPU, 1 GB memory".
export function sizeName(size: string): string {
  const { kind, cpus, memoryMb } = parseSize(size);
  return `${cpus} ${kind} CPU${cpus === 1 ? "" : "s"}, ${memoryMb / 1024} GB memory`;
}
