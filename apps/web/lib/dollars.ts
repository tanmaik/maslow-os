// Money and days as the person reads them: dollars, never tokens.

// "$3.42", "$10".
export function dollars(usd: number): string {
  return usd >= 10 || usd === 0
    ? `$${Math.round(usd * 100) / 100}`
    : `$${usd.toFixed(2)}`;
}

// "Monday": the day a weekly ceiling turns over.
export function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

// "Sep 12", for the "2026-09-12" a day is grouped under.
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
