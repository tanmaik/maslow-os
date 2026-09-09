import Link from "next/link";

import { cn } from "@/lib/utils";

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
      className={cn("size-2 shrink-0 rounded-[2px]", className)}
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
  const inner = (
    <>
      <TypeIcon type={type} />
      {type}
    </>
  );
  const classes = cn("inline-flex items-center gap-2", className);
  return link ? (
    <Link
      href={typeHref(type, owner)}
      className={cn(classes, "hover:underline")}
    >
      {inner}
    </Link>
  ) : (
    <span className={classes}>{inner}</span>
  );
}
