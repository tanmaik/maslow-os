# The screen is a desktop

Decided 2026-09-11 with Tanmai. Supersedes the room as a tiling of blocks
and, the same day, the room as a home screen of cells.

## What was rejected

The room was a tiling: a tree of splits, every window given a share of
the screen worked out from the others, desktops as slides. Rejected on
every count. Then it was a home screen: a fixed grid of cells with
widgets of fixed sizes snapping into them. Rejected the same day, with
Gödel Terminal named as the reference: a Bloomberg-style workspace where
panels are windows placed anywhere on a black canvas, dense to the edge,
opened by typing a short code, kept as several workspaces.

## What the screen is

A desktop the size of the display, drawn on the canvas, that never
scrolls. Every surface of Maslow is a window on it: the terminal, the
files, the brain, the computer, the browser, a port, a record. A window
goes anywhere the person puts it, at any size they drag it to, may
overlap another, and comes to the front when touched. Nothing lays it
out for them and nothing resizes one window because another changed.

Where a window sits and how big it is are kept as shares of the desktop's
width and height, so a desktop laid out on one display reads the same on
another. New windows open where the person clicked with the tool in
hand, or where a drag from the toolbar dropped them, or, asked for by
name, a little down and to the right of the last, like paper on a desktop.

Any window fills the screen with one press and comes back with another;
filling the screen is the same window in place, so what it holds keeps
running. Desktops are pages, swiped between, with dots, and a right-click
on the desktop, a long press on a phone, offers a new desktop or taking an
empty one away.

A phone has no room for a desktop: it shows one window at a time, full
screen in portrait, swiped between in the order they were placed, with
the same toolbar along the bottom.

## The atoms

| Atom        | What it is                                           | Exact                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas      | The desktop. Never scrolls. Desktops swipe as pages. | The warm ground, a shade under the windows, faintly dotted. No image.                                                                                                                                                                                                                                                                                                                                                                             |
| Window      | The only thing on the canvas.                        | Title bar with its buttons, body, resize corner 12px. Soft corners, a soft warm shadow, a hairline border and nothing else, over the page. No smaller than 14% × 16% of the desktop.                                                                                                                                                                                                                                                              |
| Title bar   | Grab handle and identity.                            | A hairline below. Mark 14px, name 12px medium, then fill-screen and take-down at 24px.                                                                                                                                                                                                                                                                                                                                                            |
| Body        | The surface itself, framed.                          | Opaque. No padding from us; every surface owns its own.                                                                                                                                                                                                                                                                                                                                                                                           |
| Dock        | Every block, along the bottom.                       | Rounded strip with a hairline border and the same shadow, 40px marks, 2px gaps. A click opens a new window at the block's size, again and again. Ports after a hairline, then the pin. Pinned, it stays; unpinned, it hides, the desktop takes the whole page, and a tab at the bottom edge brings it back for a moment. Every block is a window. Settings is one block, not a mark for each of its sections: a dock holds what is reached often. |
| Command bar | Type to open, like Gödel's.                          | ⌘K, or typing on the desktop. Field, top centre, 36px. "term" opens Terminal, "3000" a port, a title a record.                                                                                                                                                                                                                                                                                                                                    |
| Dots        | Which desktop is in view.                            | Rounded strip, 6px dots, the one in view in the accent, only with more than one desktop.                                                                                                                                                                                                                                                                                                                                                          |
| Ghost       | Where a window will land.                            | Dashed outline at the block's size, following the pointer.                                                                                                                                                                                                                                                                                                                                                                                        |
| Menu        | Right-click on the desktop or a bar.                 | New desktop, remove desktop; fill screen, take down.                                                                                                                                                                                                                                                                                                                                                                                              |
| You         | Who is at the desktop.                               | The dock's last mark: picture or initials; the other orgs, a new org, the way out. What waits on you is a count on the Brain's mark.                                                                                                                                                                                                                                                                                                              |

Density: unchanged. Gaps 4px, desktop inset 6px, chrome text 12px, marks 14px in bars
and 18px in the toolbar. Motion: none. A window appears where it opens
and goes when it is taken down.

## The look

Plain, at Tanmai's word on 2026-09-11, which took liquid glass back out
the same day it went in: a hairline border, a flat title bar with its
buttons, strips for the toolbar and the dots, and nothing that animates.
The skin over it is
[the look is warm](2026-09-12-the-look-is-warm.md): warm neutrals, one
orange, soft corners and a soft shadow.

## A window is a panel, not a page

Settled 2026-09-11, after a day of framing pages: a window that loads one
of our pages in a frame carries two sets of chrome, the window's bar and
the page's own header and margins, and never feels like one thing. So a
surface is drawn in the window itself, and the few controls it needs sit
in the window's bar after the name: Files puts its path and Upload
there, the Browser its address with back, forward and reload, the
Terminal nothing. A panel says so by rendering its controls inside
`InBar`, which draws them in the bar when the panel is in a window and
where they are when the same component is a page of its own. Terminal,
Files and Browser are panels; every other surface still frames as the
page it is until it is made one.

## What is stored

A desktop is stored as its windows, in the order they stack, each with what
it frames and its place and size as shares of the desktop. A desktop kept in
either older shape, a tree of splits or a grid of cells, is read as its
windows in order and kept in this shape the first time it is opened; no
migration touches the table. The server refuses a desktop that is not well
formed: a window off the desktop, below the smallest size, framing an
address not our own, or two windows of one name.

## Built and not yet built

Built: the desktop, its windows, each with a name of its own so one block
may be open twice, Terminal, Files and Browser as panels, a click on the toolbar that opens a window, drag and
drop from the toolbar, drag to move and a corner to resize, front on
touch, fill screen, desktops as pages, the desktop's menu, the phone's one
window at a time, the conversion of older desktops. Not yet built: the
command bar and the density pass to the exact atoms above.

## What proves it

A click on the toolbar opens a window at the block's size, and a second
click opens a second; a dragged
window stays where it was dropped across a reload; a corner drag resizes
it and no other window moves; a touched window comes to the front; a
window filled to the screen keeps its terminal attached; a phone shows
one window per page. The gate is green.
