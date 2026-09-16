import type { Size } from "@maslow/db/computers";

// The ladder of sizes, each its CPUs and memory and no price; the disk is
// apart from it. Every computer starts at the first rung. Shared by the
// page and the server, so it holds nothing but the ladder.
export const SIZES = {
  small: { name: "Small", cpuKind: "shared", cpus: 4, memoryMb: 8192 },
  medium: { name: "Medium", cpuKind: "shared", cpus: 8, memoryMb: 16384 },
  large: { name: "Large", cpuKind: "performance", cpus: 4, memoryMb: 16384 },
  dedicated: {
    name: "Dedicated",
    cpuKind: "performance",
    cpus: 8,
    memoryMb: 32768,
  },
} as const satisfies Record<string, Size & { name: string }>;

export type SizeKey = keyof typeof SIZES;

export const isSize = (v: unknown): v is SizeKey =>
  typeof v === "string" && v in SIZES;

export const sameSize = (a: Size, b: Size) =>
  a.cpuKind === b.cpuKind && a.cpus === b.cpus && a.memoryMb === b.memoryMb;

// The rung above a computer's: the next one up the whole ladder, so a lift
// walks small to medium to large to dedicated and reaches the top; a
// computer on no rung is lifted onto the first with more memory than it
// has. Null at the top.
export const above = (c: Size): SizeKey | null => {
  const rungs = Object.keys(SIZES) as SizeKey[];
  const on = rungs.findIndex((k) => sameSize(SIZES[k], c));
  return on >= 0
    ? (rungs[on + 1] ?? null)
    : (rungs.find((k) => SIZES[k].memoryMb > c.memoryMb) ?? null);
};

// The rung a computer is on, or null when it is on none.
export const sizeOf = (c: Size): SizeKey | null =>
  (Object.keys(SIZES) as SizeKey[]).find((k) => sameSize(SIZES[k], c)) ?? null;

// A size in words: "4 shared CPUs, 4 GB memory".
export const specs = (s: Size) =>
  `${s.cpus} ${s.cpuKind === "performance" ? "dedicated" : "shared"} CPUs, ${s.memoryMb / 1024} GB memory`;
