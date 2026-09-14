"use client";

import type { Property } from "@maslow/brain";
import { RiCheckLine } from "@remixicon/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";

import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Pagination } from "@/components/base/pagination/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@/components/base/table/table";
import { ChevronSortDown } from "@/components/foundations/icons/chevrons";
import { LocalTime } from "@/components/local-time";
import { cx } from "@/utils/cx";

import { cell, recordHref } from "../format";

// A column that holds its place while the table is dragged sideways.
const STUCK = "max-sm:sticky max-sm:z-10 max-sm:bg-background-primary-default";

import { TypeIcon } from "../type-icon";
import { Chosen } from "./chosen";
import type { Column } from "./columns";
import { WHEN, type Row } from "./query";

const SELECT = "__select__";
const REST = "__rest__";

// Whether a column has an order the door can sort by: a list has no order,
// and the title and the type are what the row already reads as.
const sortable = (kind: Column["kind"]) =>
  kind !== "list" && kind !== "title" && kind !== "type";

// A declared value as its kind reads: a number in figures that line up, a
// yes as a tick and a no as nothing, a choice and a list as soft chips.
function value(kind: Column["kind"], v: unknown, p?: Property): ReactNode {
  if (v === undefined || v === null || v === "") return null;
  if (kind === "boolean") {
    return v ? (
      <RiCheckLine
        className="size-4 text-foreground-icon-secondary"
        aria-label="yes"
      />
    ) : (
      <span className="text-text-placeholder">no</span>
    );
  }
  if (kind === "enum") {
    return (
      <Chip variant="caption" color="soft">
        {String(v)}
      </Chip>
    );
  }
  if (kind === "list" && Array.isArray(v)) {
    return (
      <span className="flex flex-wrap gap-1">
        {v.map((x) => (
          <Chip key={String(x)} variant="caption" color="soft">
            {String(x)}
          </Chip>
        ))}
      </span>
    );
  }
  // An instant is written in UTC and read in the reader's own zone, so
  // the browser is what says the hour, not the server that rendered it.
  if (kind === "datetime") {
    return (
      <span className="truncate tabular-nums">
        <LocalTime at={String(v)} fallback="" />
      </span>
    );
  }
  return (
    <span className={cx("truncate", kind === "number" && "tabular-nums")}>
      {cell(v, p)}
    </span>
  );
}

// One column of a row as its kind draws it: the title with whose it is, the
// type with its mark, when with a local clock, and the rest as declared.
function cellFor(c: Column, r: Row, properties: Property[]): ReactNode {
  if (c.kind === "title") {
    return (
      <span className="flex items-center gap-2">
        <span className="truncate text-body-medium text-text-primary">
          {r.title || "(untitled)"}
        </span>
        {r.owner && (
          <Avatar
            size="xs"
            initials={r.owner
              .split(" ")
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() ?? "")
              .join("")}
            title={r.owner}
          />
        )}
      </span>
    );
  }
  if (c.kind === "type") {
    return (
      <span className="flex items-center gap-2 truncate text-text-secondary">
        <TypeIcon type={r.type} />
        {r.type}
      </span>
    );
  }
  if (c.kind === "when") {
    return (
      <span className="text-text-secondary tabular-nums">
        {r.at && <LocalTime at={r.at} fallback="" />}
      </span>
    );
  }
  return value(
    c.kind,
    r.props[c.key],
    properties.find((p) => p.name === c.key),
  );
}

function SortChevron({ dir }: { dir: false | "asc" | "desc" }) {
  return (
    <ChevronSortDown
      className={cx(
        "size-4 shrink-0 transition-[transform,color] duration-fast ease-plain",
        dir === "asc" && "rotate-180",
        dir ? "text-text-secondary" : "text-text-tertiary",
      )}
    />
  );
}

// The records as a table: one column per declared field beside the title
// and when, sorted by the door on whichever column is clicked, and any
// number of rows chosen at once for one act on all of them. TanStack owns
// the row and column model; the door still sorts and pages, and the address
// still keeps the sort, the widths and the cursor.
export function TableView({
  rows,
  columns: given,
  properties,
  people,
  groups,
  canChoose,
  cursor,
}: {
  rows: Row[];
  columns: Column[];
  properties: Property[];
  people: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  // Only a list of the person's own records offers to act on a set of them:
  // a colleague's are not theirs to share or remove.
  canChoose: boolean;
  // The next page's cursor, or none once the door has nothing more.
  cursor: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const sort = params.get("sort") ?? WHEN;
  const direction = params.get("dir") === "asc" ? "asc" : "desc";
  // A width the person dragged, remembered with the rest of the view.
  const kept = new Map(
    (params.get("w") ?? "")
      .split(",")
      .map((s) => s.split(":"))
      .filter(([k, n]) => k && Number(n) > 0)
      .map(([k, n]) => [k!, Number(n)]),
  );
  const columns = given.map((c) => ({
    ...c,
    width: kept.get(c.key) ?? c.width,
  }));

  const go = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    change(next);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  // A column is sorted by the door: clicking the one already sorted turns
  // it round, and a list column has no order to turn.
  const sortBy = (c: Column) => {
    if (!sortable(c.kind)) return;
    const key = c.kind === "when" ? WHEN : c.key;
    go((next) => {
      next.delete("cursor");
      if (key === WHEN) next.delete("sort");
      else next.set("sort", key);
      if (key === sort && direction === "desc") next.set("dir", "asc");
      else next.delete("dir");
    });
  };
  const resize =
    (key: string, from: number, at: number) => (e: PointerEvent) => {
      const wide = Math.max(80, Math.round(from + e.clientX - at));
      const widths = new Map(columns.map((c) => [c.key, c.width]));
      widths.set(key, wide);
      go((next) =>
        next.set("w", [...widths].map(([k, n]) => `${k}:${n}`).join(",")),
      );
    };
  const more = () =>
    go((next) => {
      if (cursor) next.set("cursor", cursor);
    });

  const tanColumns = useMemo<ColumnDef<Row>[]>(() => {
    const defs: ColumnDef<Row>[] = [];
    if (canChoose) {
      defs.push({
        id: SELECT,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            size="sm"
            slot={null}
            aria-label="Choose every record here"
            isSelected={table.getIsAllRowsSelected()}
            isIndeterminate={table.getIsSomeRowsSelected()}
            onChange={(on) => table.toggleAllRowsSelected(!!on)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            size="sm"
            slot={null}
            aria-label={`Choose ${row.original.title || "this record"}`}
            isSelected={row.getIsSelected()}
            onChange={(on) => row.toggleSelected(!!on)}
          />
        ),
      });
    }
    for (const c of columns) {
      defs.push({
        id: c.key,
        // TanStack only counts a column sortable when it has a value to
        // read, even though the door — not TanStack — does the sorting.
        accessorFn: (r) =>
          c.kind === "title"
            ? r.title
            : c.kind === "type"
              ? r.type
              : c.kind === "when"
                ? r.at
                : r.props[c.key],
        enableSorting: sortable(c.kind),
        header: c.label,
        cell: ({ row }) => cellFor(c, row.original, properties),
      });
    }
    defs.push({ id: REST, enableSorting: false, header: "", cell: () => null });
    return defs;
  }, [columns, canChoose, properties]);

  const table = useReactTable({
    data: rows,
    columns: tanColumns,
    getRowId: (r) => r.id,
    state: {
      rowSelection,
      sorting: [{ id: sort, desc: direction === "desc" }],
    },
    onRowSelectionChange: setRowSelection,
    onSortingChange: () => {}, // the address drives sorting; see sortBy
    enableRowSelection: canChoose,
    manualSorting: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const chosen = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div className="flex flex-col">
      {canChoose && (
        <Chosen
          chosen={chosen}
          people={people}
          groups={groups}
          onDone={() => setRowSelection({})}
        />
      )}
      <Table
        aria-label="Records"
        size="sm"
        className="table-fixed"
        containerClassName="overflow-x-auto"
      >
        <TableHeader>
          {headers.map((header) => {
            const id = header.column.id;
            const label = flexRender(
              header.column.columnDef.header,
              header.getContext(),
            );
            if (id === SELECT) {
              return (
                <TableColumn
                  key={header.id}
                  id={id}
                  isRowHeader={false}
                  className="w-11"
                >
                  {label}
                </TableColumn>
              );
            }
            if (id === REST) {
              // Every column is as wide as it was left; this one takes what
              // is over, so a wide window is filled and a narrow one
              // scrolls.
              return (
                <TableColumn key={header.id} id={id}>
                  <span className="sr-only">the rest of the row</span>
                </TableColumn>
              );
            }
            const c = columns.find((col) => col.key === id)!;
            const canSort = header.column.getCanSort();
            return (
              <TableColumn
                key={header.id}
                id={id}
                isRowHeader={c.kind === "title"}
                style={{ width: c.width }}
                className={cx(
                  "relative text-text-secondary",
                  // On a phone the table is read by dragging it sideways,
                  // and the title stays put so every row keeps its name.
                  c.kind === "title" && STUCK,
                  c.kind === "title" &&
                    (canChoose ? "max-sm:left-11" : "max-sm:left-0"),
                )}
              >
                {canSort ? (
                  <button
                    type="button"
                    onClick={() => sortBy(c)}
                    className="flex cursor-pointer items-center gap-1 truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                  >
                    <span className="truncate">{label}</span>
                    <SortChevron dir={header.column.getIsSorted()} />
                  </button>
                ) : (
                  <span className="truncate">{label}</span>
                )}
                <span
                  aria-hidden
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setDragging(c.key);
                    const move = resize(c.key, c.width, e.clientX);
                    const up = () => {
                      setDragging(null);
                      globalThis.removeEventListener("pointermove", move);
                      globalThis.removeEventListener("pointerup", up);
                    };
                    globalThis.addEventListener("pointermove", move);
                    globalThis.addEventListener("pointerup", up);
                  }}
                  className={cx(
                    "absolute top-0 right-0 h-full w-2 cursor-col-resize border-r-2 transition-colors duration-fast ease-plain",
                    dragging === c.key
                      ? "border-accent-500"
                      : "border-transparent hover:border-border-button-hover",
                  )}
                />
              </TableColumn>
            );
          })}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              id={row.id}
              onAction={() => router.push(recordHref(row.original.id))}
              className="cursor-pointer outline-none transition-colors duration-fast ease-plain hover:bg-background-primary-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring"
            >
              {row.getVisibleCells().map((c) => {
                const title =
                  columns.find((col) => col.key === c.column.id)?.kind ===
                  "title";
                return (
                  <TableCell
                    key={c.id}
                    className={cx(
                      title && STUCK,
                      title && (canChoose ? "max-sm:left-11" : "max-sm:left-0"),
                    )}
                  >
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cursor && (
        <div className="border-t border-separator-border p-3">
          <Pagination mode="cursor" hasNext onNext={more} />
        </div>
      )}
    </div>
  );
}
