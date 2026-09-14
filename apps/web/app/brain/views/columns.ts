import type { Datatype, Property } from "@maslow/brain";

import { WHEN } from "./query";

// A column of the table: what it reads out of a record, what it is called,
// and how wide it starts. The title is the record itself; when is the one
// thing every record has; the rest are the type's declared fields.
export type Column = {
  key: string;
  label: string;
  kind: Datatype | "title" | "when" | "type";
  width: number;
};

// How wide a column of each kind starts, before anyone drags it. The title
// takes whatever is left, so a table fills the sheet it sits in.
const WIDTH: Record<Column["kind"], number> = {
  title: 320,
  when: 180,
  type: 140,
  text: 200,
  number: 120,
  boolean: 100,
  date: 140,
  datetime: 180,
  enum: 140,
  list: 200,
};

// Which columns a list of one type shows, and which a list of everything
// does: everything has no declared field in common, so it shows what every
// record has.
export function columnsFor(
  properties: Property[],
  everything: boolean,
): Column[] {
  const columns: Column[] = [
    { key: "title", label: "title", kind: "title", width: WIDTH.title },
  ];
  if (everything) {
    columns.push({
      key: "type",
      label: "type",
      kind: "type",
      width: WIDTH.type,
    });
  }
  for (const p of properties) {
    columns.push({
      key: p.name,
      label: p.name,
      kind: p.datatype,
      width: WIDTH[p.datatype],
    });
  }
  columns.push({ key: WHEN, label: WHEN, kind: "when", width: WIDTH.when });
  return columns;
}
