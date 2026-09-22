import {
  RiApps2Line,
  RiDatabase2Line,
  RiFolderLine,
  RiGlobalLine,
  RiSettings3Line,
  RiTerminalBoxLine,
} from "@remixicon/react";
import type { ComponentType, SVGProps } from "react";

import type { Box, Kind } from "@/app/desktop/tiles";

// A mark: an icon drawn as an SVG with no children of its own, as every
// Remix icon is.
export type Mark = ComponentType<Omit<SVGProps<SVGSVGElement>, "children">>;

// An app of Maslow's own: its kind, its name, what it is for, where it
// is, the mark it wears, and the size it takes as a widget, as shares of
// the board.
export type App = {
  kind: Kind;
  title: string;
  says: string;
  href: string;
  mark: Mark;
  box: Box;
};

// The apps everyone has, in the order the sidebar and Home list them.
export const APPS: App[] = [
  {
    kind: "brain",
    title: "Database",
    says: "Your records, and the ones shared with you",
    href: "/brain",
    mark: RiDatabase2Line,
    box: { w: 0.62, h: 0.72 },
  },
  {
    kind: "page",
    title: "Files",
    says: "Your computer's files, and what colleagues shared",
    href: "/computer/files",
    mark: RiFolderLine,
    box: { w: 0.4, h: 0.66 },
  },
  {
    kind: "page",
    title: "Terminal",
    says: "A shell on your computer that keeps running when you leave",
    href: "/computer/terminal",
    mark: RiTerminalBoxLine,
    box: { w: 0.56, h: 0.7 },
  },
  {
    kind: "page",
    title: "Browser",
    says: "The browser on your computer, driven from here",
    href: "/browser",
    mark: RiGlobalLine,
    box: { w: 0.6, h: 0.76 },
  },
  {
    kind: "page",
    title: "Ports",
    says: "What is running on your computer: open, share or name it",
    href: "/computer/ports",
    mark: RiApps2Line,
    box: { w: 0.4, h: 0.56 },
  },
  {
    kind: "settings",
    title: "Settings",
    says: "You, your computer, access and your org",
    href: "/settings",
    mark: RiSettings3Line,
    box: { w: 0.5, h: 0.72 },
  },
];

// The size a window opens at: the block's; a port is a whole app and opens
// wide, a record opens small.
// An address without what follows the question mark: a window opened on
// one pane of Settings is still a Settings window.
const pathOf = (href: string): string => href.split("?")[0]!;

export const boxOf = (t: { kind: Kind; href: string }): Box =>
  APPS.find((b) => b.href === pathOf(t.href))?.box ??
  (t.kind === "port"
    ? { w: 0.48, h: 0.62 }
    : t.kind === "record"
      ? { w: 0.3, h: 0.42 }
      : { w: 0.42, h: 0.6 });

// A port as something to open: a window of it, at the size a port opens.
export const portItem = (p: { title: string; href: string }) => ({
  kind: "port" as const,
  title: p.title,
  href: p.href,
  box: boxOf({ kind: "port", href: p.href }),
});

// Where an app fills the screen: the page of ours that frames its port.
export const appHref = (app: { title: string; href: string }) =>
  `/computer/app?at=${encodeURIComponent(app.href)}&title=${encodeURIComponent(app.title)}`;
