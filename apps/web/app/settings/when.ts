const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// A day as settings says one, everywhere: "13 Sep 2026". Never a time, and
// never the browser's own format. Read it on the server and hand the page
// the words, so the server and the page never disagree.
export function on(when: Date | string): string {
  const d = typeof when === "string" ? new Date(when) : when;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
