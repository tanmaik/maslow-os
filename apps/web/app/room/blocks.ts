import {
  BuildingOffice2Icon,
  CommandLineIcon,
  ComputerDesktopIcon,
  CpuChipIcon,
  DocumentIcon,
  FolderIcon,
  GlobeAltIcon,
  KeyIcon,
  LinkIcon,
  Square3Stack3DIcon,
  UserGroupIcon,
  UserIcon,
  UsersIcon,
  WindowIcon,
} from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";

import type { Box, Kind } from "@/app/room/tiles";

export type Mark = ComponentType<SVGProps<SVGSVGElement>>;

// A building block: one surface of Maslow the toolbar offers. Its kind,
// its name, the address it frames, the mark it wears, and the size it
// opens at as a window, as shares of the desk.
export type Block = {
  kind: Kind;
  title: string;
  href: string;
  mark: Mark;
  box: Box;
};

// The blocks every toolbar offers. Settings is not one block but each of
// its sections, so a person opens exactly the part they need.
export const BLOCKS: Block[] = [
  {
    kind: "page",
    title: "Terminal",
    href: "/computer/terminal",
    mark: CommandLineIcon,
    box: { w: 0.56, h: 0.7 },
  },
  {
    kind: "page",
    title: "Files",
    href: "/computer/files",
    mark: FolderIcon,
    box: { w: 0.4, h: 0.66 },
  },
  {
    kind: "brain",
    title: "Brain",
    href: "/brain",
    mark: Square3Stack3DIcon,
    box: { w: 0.46, h: 0.7 },
  },
  {
    kind: "page",
    title: "Computer",
    href: "/computer",
    mark: ComputerDesktopIcon,
    box: { w: 0.34, h: 0.5 },
  },
  {
    kind: "page",
    title: "Browser",
    href: "/browser",
    mark: GlobeAltIcon,
    box: { w: 0.6, h: 0.76 },
  },
  {
    kind: "settings",
    title: "You",
    href: "/settings?only=you",
    mark: UserIcon,
    box: { w: 0.34, h: 0.4 },
  },
  {
    kind: "settings",
    title: "Members",
    href: "/settings?only=members",
    mark: UsersIcon,
    box: { w: 0.4, h: 0.52 },
  },
  {
    kind: "settings",
    title: "Groups",
    href: "/settings?only=groups",
    mark: UserGroupIcon,
    box: { w: 0.36, h: 0.46 },
  },
  {
    kind: "settings",
    title: "Agents",
    href: "/settings?only=agents",
    mark: CpuChipIcon,
    box: { w: 0.4, h: 0.52 },
  },
  {
    kind: "settings",
    title: "Connected apps",
    href: "/settings?only=apps",
    mark: LinkIcon,
    box: { w: 0.4, h: 0.52 },
  },
  {
    kind: "settings",
    title: "SSH",
    href: "/settings?only=ssh",
    mark: KeyIcon,
    box: { w: 0.4, h: 0.42 },
  },
  {
    kind: "settings",
    title: "Org",
    href: "/settings?only=org",
    mark: BuildingOffice2Icon,
    box: { w: 0.34, h: 0.42 },
  },
];

// The size a window opens at: the block's; a port is a whole app and opens
// wide, a record opens small.
export const boxOf = (t: { kind: Kind; href: string }): Box =>
  BLOCKS.find((b) => b.href === t.href)?.box ??
  (t.kind === "port"
    ? { w: 0.48, h: 0.62 }
    : t.kind === "record"
      ? { w: 0.3, h: 0.42 }
      : { w: 0.42, h: 0.6 });

// The mark a window wears: the block's, or the kind's when the toolbar
// did not offer it, like a port or a record.
export const markOf = (t: { kind: Kind; href: string }): Mark =>
  BLOCKS.find((b) => b.href === t.href)?.mark ??
  (t.kind === "record" ? DocumentIcon : WindowIcon);
