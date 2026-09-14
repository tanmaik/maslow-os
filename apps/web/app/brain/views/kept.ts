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
  "show",
  "w",
  "by",
  "whose",
] as const;

// Which list a remembered view belongs to: everything, or one person's type.
export const subjectOf = (type?: string, owner?: string) =>
  type ? `${owner ?? ""}:${type}` : "";
