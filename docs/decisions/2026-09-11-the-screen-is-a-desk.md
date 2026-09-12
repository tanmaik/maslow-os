# The screen is a desk

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

A desk the size of the display, drawn on the canvas, that never
scrolls. Every surface of Maslow is a window on it: the terminal, the
files, the brain, the computer, the browser, a port, a record. A window
goes anywhere the person puts it, at any size they drag it to, may
overlap another, and comes to the front when touched. Nothing lays it
out for them and nothing resizes one window because another changed.

Where a window sits and how big it is are kept as shares of the desk's
width and height, so a desk laid out on one display reads the same on
another. New windows open where the person clicked with the tool in
hand, or where a drag from the toolbar dropped them, or, asked for by
name, a little down and to the right of the last, like paper on a desk.

Any window fills the screen with one press and comes back with another;
filling the screen is the same window in place, so what it holds keeps
running. Desks are pages, swiped between, with dots, and a right-click
on the desk, a long press on a phone, offers a new desk or taking an
empty one away.

A phone has no room for a desk: it shows one window at a time, full
screen in portrait, swiped between in the order they were placed, with
the same toolbar along the bottom.

## The atoms

| Atom        | What it is                                     | Exact                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas      | The desk. Never scrolls. Desks swipe as pages. | Pure black. No image.                                                                                                                                                                                                                                                                                                                               |
| Window      | The only thing on the canvas.                  | Title bar with its buttons, body, resize corner 12px. Square corners, no shadow, a hairline border and nothing else, over the page. No smaller than 14% × 16% of the desk.                                                                                                                                                                          |
| Title bar   | Grab handle and identity.                      | Flat, a hairline below. Mark 14px, name 12px medium, then fill-screen and take-down at 24px.                                                                                                                                                                                                                                                        |
| Body        | The surface itself, framed.                    | Opaque. No padding from us; every surface owns its own.                                                                                                                                                                                                                                                                                             |
| Dock        | Every block, along the bottom.                 | Flat strip with a hairline border, 40px marks, 2px gaps. A click opens a new window at the block's size, again and again. Ports after a hairline, then the pin. Pinned, it stays; unpinned, it hides, the desk takes the whole page, and a tab at the bottom edge brings it back for a moment. Every block is a window, settings sections included. |
| Command bar | Type to open, like Gödel's.                    | ⌘K, or typing on the desk. Flat field, top centre, 36px. "term" opens Terminal, "3000" a port, a title a record.                                                                                                                                                                                                                                    |
| Dots        | Which desk is in view.                         | Flat strip, 6px dots, only with more than one desk.                                                                                                                                                                                                                                                                                                 |
| Ghost       | Where a window will land.                      | Dashed outline at the block's size, following the pointer.                                                                                                                                                                                                                                                                                          |
| Menu        | Right-click on the desk or a bar.              | New desk, remove desk; fill screen, take down.                                                                                                                                                                                                                                                                                                      |
| You         | Who is at the desk.                            | The dock's last mark: picture or initials; the other orgs, a new org, the way out. What waits on you is a count on the Brain's mark.                                                                                                                                                                                                                |

Density: gaps 4px, desk inset 6px, chrome text 12px, marks 14px in bars
and 18px in the toolbar. Motion: none. A window appears where it opens
and goes when it is taken down.

## The look

Plain, at Tanmai's word on 2026-09-11, which took liquid glass back out
the same day it went in: square windows with no shadow, a hairline
border, a flat title bar with its buttons, flat strips for the toolbar
and the dots, and nothing that animates. Gödel Terminal is the
reference: click a thing, it opens at its size, move it, resize it.

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

A desk is stored as its windows, in the order they stack, each with what
it frames and its place and size as shares of the desk. A desk kept in
either older shape, a tree of splits or a grid of cells, is read as its
windows in order and kept in this shape the first time it is opened; no
migration touches the table. The server refuses a desk that is not well
formed: a window off the desk, below the smallest size, framing an
address not our own, or two windows of one name.

## Built and not yet built

Built: the desk, its windows, each with a name of its own so one block
may be open twice, Terminal, Files and Browser as panels, a click on the toolbar that opens a window, drag and
drop from the toolbar, drag to move and a corner to resize, front on
touch, fill screen, desks as pages, the desk's menu, the phone's one
window at a time, the conversion of older desks. Not yet built: the
command bar and the density pass to the exact atoms above.

## What proves it

A click on the toolbar opens a window at the block's size, and a second
click opens a second; a dragged
window stays where it was dropped across a reload; a corner drag resizes
it and no other window moves; a touched window comes to the front; a
window filled to the screen keeps its terminal attached; a phone shows
one window per page. The gate is green.
