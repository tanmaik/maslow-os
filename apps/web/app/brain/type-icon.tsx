import Link from "next/link";

import { cx } from "@/utils/cx";

import { typeColor, typeHref } from "./format";

// A type's mark, in the type's one colour.
export function TypeIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  return (
    <span
      className={cx("size-2 shrink-0 rounded-[2px]", className)}
      style={{ background: typeColor(type) }}
      aria-hidden
    />
  );
}

// A type named beside its mark, linking to its table unless told not to.
// Owner names whose the type is when it is someone else's.
export function TypeMark({
  type,
  owner,
  link = true,
  className,
}: {
  type: string;
  owner?: string;
  link?: boolean;
  className?: string;
}) {
  // The name truncates, not the row: an ellipsis belongs on the text node,
  // and a flex container never draws one.
  const inner = (
    <>
      <TypeIcon type={type} />
      <span className="truncate">{type}</span>
    </>
  );
  const classes = cx("inline-flex min-w-0 items-center gap-2", className);
  return link ? (
    <Link
      href={typeHref(type, owner)}
      className={cx(classes, "hover:underline")}
    >
      {inner}
    </Link>
  ) : (
    <span className={classes}>{inner}</span>
  );
}
