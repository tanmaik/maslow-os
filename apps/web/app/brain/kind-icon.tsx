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

import { cn } from "@/lib/utils";

import { kindColor, kindHref } from "./format";

// One icon per kind of thing, by the name a kind is usually given. A kind
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

// A kind's icon in the kind's one colour.
export function KindIcon({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  const Icon = ICONS[kind] ?? BoxIcon;
  return (
    <Icon
      className={cn("size-3.5 shrink-0", className)}
      style={{ color: kindColor(kind) }}
      strokeWidth={2}
      aria-hidden
    />
  );
}

// A kind named beside its icon, linking to its table unless told not to.
export function KindMark({
  kind,
  link = true,
  className,
}: {
  kind: string;
  link?: boolean;
  className?: string;
}) {
  const inner = (
    <>
      <KindIcon kind={kind} />
      {kind}
    </>
  );
  const classes = cn("inline-flex items-center gap-1.5", className);
  return link ? (
    <a href={kindHref(kind)} className={cn(classes, "hover:underline")}>
      {inner}
    </a>
  ) : (
    <span className={classes}>{inner}</span>
  );
}
