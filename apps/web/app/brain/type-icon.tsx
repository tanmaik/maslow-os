import {
  BoxIcon,
  BuildingIcon,
  CalendarIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  LayoutGridIcon,
  LightbulbIcon,
  MailIcon,
  MapPinIcon,
  SquareCheckIcon,
  StickyNoteIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { typeColor, typeHref } from "./format";

// One icon per type of thing, by the name a type is usually given. A type
// with a name of its own gets a box.
const ICONS: Record<string, typeof BoxIcon> = {
  person: UserIcon,
  contact: UserIcon,
  people: UsersIcon,
  team: UsersIcon,
  message: MailIcon,
  email: MailIcon,
  event: CalendarIcon,
  meeting: CalendarIcon,
  commitment: SquareCheckIcon,
  task: SquareCheckIcon,
  todo: SquareCheckIcon,
  note: StickyNoteIcon,
  file: FileIcon,
  document: FileTextIcon,
  tile: LayoutGridIcon,
  belief: LightbulbIcon,
  idea: LightbulbIcon,
  project: FolderIcon,
  company: BuildingIcon,
  org: BuildingIcon,
  place: MapPinIcon,
  topic: TagIcon,
};

// A type's icon in the type's one colour.
export function TypeIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const Icon = ICONS[type] ?? BoxIcon;
  return (
    <Icon
      className={cn("size-3.5 shrink-0", className)}
      style={{ color: typeColor(type) }}
      strokeWidth={2}
      aria-hidden
    />
  );
}

// A type named beside its icon, linking to its table unless told not to.
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
  const classes = cn("inline-flex items-center gap-1.5", className);
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
