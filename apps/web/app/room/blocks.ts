import {
  RiBrainLine,
  RiChat3Line,
  RiFileTextLine,
  RiFolderLine,
  RiGlobalLine,
  RiSettings3Line,
  RiTerminalBoxLine,
  RiWindowLine,
} from "@remixicon/react";
import type { ComponentType, SVGProps } from "react";

import type { Box, Cap, Kind } from "@/app/room/tiles";

// A mark: an icon drawn as an SVG with no children of its own, as every
// Remix icon is.
export type Mark = ComponentType<Omit<SVGProps<SVGSVGElement>, "children">>;

// A building block: one surface of Maslow the dock offers. Its kind, its
// name, the address it frames, the mark it wears in a window's bar, the
// icon it wears in the dock, the size it opens at as a window, as shares
// of the desk, and the sizes it is worth being, in pixels.
export type Block = {
  kind: Kind;
  title: string;
  href: string;
  mark: Mark;
  face: string;
  box: Box;
  bounds: Bounds;
};

// How small and how big a window of a surface is worth being, in pixels,
// so it means the same on every display: below its least its own layout
// breaks, and past its most it stops using the room it is given and is
// white space. A surface with no most grows as far as the desk.
export type Bounds = { min: Cap; max?: Cap };

const PORT: Bounds = { min: { w: 360, h: 240 } };
const RECORD: Bounds = { min: { w: 560, h: 420 }, max: { w: 880 } };
// A widget is put down at the size the person wants it on the desk.
const WIDGET: Bounds = { min: { w: 240, h: 160 } };

// The blocks every dock offers: the places a person works, and settings
// as one of them. A dock holds what is reached often, and what is reached
// once is behind one icon.
export const BLOCKS: Block[] = [
  {
    kind: "page",
    title: "Files",
    href: "/computer/files",
    mark: RiFolderLine,
    face: "/dock/files.png",
    box: { w: 0.4, h: 0.66 },
    bounds: { min: { w: 480, h: 360 } },
  },
  {
    kind: "page",
    title: "Terminal",
    href: "/computer/terminal",
    mark: RiTerminalBoxLine,
    face: "/dock/terminal.png",
    box: { w: 0.56, h: 0.7 },
    bounds: { min: { w: 480, h: 320 } },
  },
  {
    kind: "page",
    title: "Agent",
    href: "/computer/agent",
    mark: RiChat3Line,
    face: "/dock/agent.png",
    box: { w: 0.62, h: 0.74 },
    bounds: { min: { w: 520, h: 420 } },
  },
  {
    kind: "brain",
    title: "Brain",
    href: "/brain",
    mark: RiBrainLine,
    face: "/dock/brain.png",
    box: { w: 0.62, h: 0.72 },
    bounds: { min: { w: 680, h: 440 }, max: { w: 1280 } },
  },
  {
    kind: "page",
    title: "Agent's browser",
    href: "/browser",
    mark: RiGlobalLine,
    face: "/dock/browser.png",
    box: { w: 0.6, h: 0.76 },
    bounds: { min: { w: 560, h: 400 } },
  },
  {
    kind: "settings",
    title: "Settings",
    href: "/settings",
    mark: RiSettings3Line,
    face: "/dock/settings.png",
    box: { w: 0.5, h: 0.72 },
    // Settings is a toolbar and a grid of panes; wider than this it is
    // white space.
    bounds: { min: { w: 600, h: 440 }, max: { w: 960 } },
  },
];

// The size a window opens at: the block's; a port is a whole app and opens
// wide, a record opens small.
// An address without what follows the question mark: a window opened on
// one pane of Settings is still a Settings window.
export const pathOf = (href: string): string => href.split("?")[0]!;

export const boxOf = (t: { kind: Kind; href: string }): Box =>
  BLOCKS.find((b) => b.href === pathOf(t.href))?.box ??
  (t.kind === "port"
    ? { w: 0.48, h: 0.62 }
    : t.kind === "record"
      ? { w: 0.3, h: 0.42 }
      : { w: 0.42, h: 0.6 });

// Another window of what this one shows: the same block at the same size,
// under the same name. The number a window wears is only what tells two of
// them apart, so it is never carried into the next one.
export const anotherOf = (card: {
  kind: Kind;
  title: string;
  href: string;
}) => ({
  kind: card.kind,
  title: card.title.replace(/\s\d+$/, ""),
  href: card.href,
  box: boxOf(card),
});

// The sizes a window is worth being: the block's, the kind's where the
// dock does not offer it, and a widget's wherever it lies on the desk.
export const boundsOf = (t: {
  kind: Kind;
  href: string;
  pinned?: boolean;
}): Bounds =>
  t.pinned
    ? WIDGET
    : (BLOCKS.find((b) => b.href === pathOf(t.href))?.bounds ??
      (t.kind === "record" ? RECORD : PORT));

// The mark a window wears: the block's, or the kind's when the dock did
// not offer it, like a port or a record.
export const markOf = (t: { kind: Kind; href: string }): Mark =>
  BLOCKS.find((b) => b.href === pathOf(t.href))?.mark ??
  (t.kind === "record" ? RiFileTextLine : RiWindowLine);

// The icon a window wears in the dock: the block's, or the kind's.
export const faceOf = (t: { kind: Kind; href: string }): string =>
  BLOCKS.find((b) => b.href === pathOf(t.href))?.face ??
  (t.kind === "record" ? "/dock/record.png" : "/dock/port.png");
