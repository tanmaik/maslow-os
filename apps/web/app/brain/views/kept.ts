// What the address says about how a list is looked at, as against what it
// is a list of and what is being asked of it: the view, the conditions, the
// sort, the board's columns, the calendar's field, the table's widths. A
// search is a question about the records and is never remembered; which
// month the calendar is on is where the person is, not how they look.
export const KEPT = [
  "view",
  "f",
  "sort",
  "dir",
  "group",
  "on",
  "w",
  "by",
  "whose",
] as const;

// An address that says nothing about how to look opens the view the person
// kept, so one they have just cleared has to say so, or the clearing is
// undone by what was kept: the list, written out.
export function saidOutright(next: URLSearchParams): void {
  if (!KEPT.some((k) => next.has(k))) next.set("view", "list");
}

// Which list a remembered view belongs to: everything, or one person's type.
export const subjectOf = (type?: string, owner?: string) =>
  type ? `${owner ?? ""}:${type}` : "";
