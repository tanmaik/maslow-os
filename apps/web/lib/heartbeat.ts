// The cadences a person can give their agent's own runs: off, or how
// many minutes between one and the next.
export const EVERY = [
  { minutes: 0, label: "Off" },
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "Hourly" },
  { minutes: 1440, label: "Daily" },
] as const;
