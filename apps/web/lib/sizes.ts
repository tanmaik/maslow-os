import type { Size } from "@placeholder/db/computers";

// The ladder of sizes, each its CPUs and memory and no price; the disk is
// apart from it. Every computer starts at the first rung. Shared by the
// page and the server, so it holds nothing but the ladder.
export const SIZES = {
  small: { name: "Small", cpuKind: "shared", cpus: 2, memoryMb: 2048 },
  medium: { name: "Medium", cpuKind: "shared", cpus: 4, memoryMb: 4096 },
  large: { name: "Large", cpuKind: "shared", cpus: 8, memoryMb: 8192 },
  dedicated: {
    name: "Dedicated",
    cpuKind: "performance",
    cpus: 2,
    memoryMb: 8192,
  },
} as const satisfies Record<string, Size & { name: string }>;

export type SizeKey = keyof typeof SIZES;

export const isSize = (v: unknown): v is SizeKey =>
  typeof v === "string" && v in SIZES;

export const sameSize = (a: Size, b: Size) =>
  a.cpuKind === b.cpuKind && a.cpus === b.cpus && a.memoryMb === b.memoryMb;

// The rung a computer is on, or null when it is on none.
export const sizeOf = (c: Size): SizeKey | null =>
  (Object.keys(SIZES) as SizeKey[]).find((k) => sameSize(SIZES[k], c)) ?? null;

// A size in words: "4 shared CPUs, 4 GB memory".
export const specs = (s: Size) =>
  `${s.cpus} ${s.cpuKind === "performance" ? "dedicated" : "shared"} CPUs, ${s.memoryMb / 1024} GB memory`;
