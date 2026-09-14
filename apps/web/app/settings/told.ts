// What the last save left to say, and whether it is a refusal. A refusal
// is shown in red with the warning mark; everything else is a plain line,
// since "Removed." and "Connected." are not failures.
export type Told = { text: string | null; tone: "notice" | "wrong" };
