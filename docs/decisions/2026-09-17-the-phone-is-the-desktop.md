# 2026-09-17 — The phone is the desktop

## Decided

On a phone Maslow draws the same desktop it draws on a laptop: the
wallpaper, the menu bar, the windows and the dock. There is no home grid
of tiles, no handle under the screen, no deck of recents, and no
one-app-at-a-time shell. What changes on a phone is how a window sits:
every window is the full width of the screen, 8px in from either side; it
opens at its app's own height, under the menu bar; it moves up and down
only, by its title bar; it resizes from its top and bottom edges only;
a double-tap on its title bar fills the screen and a second one brings it
back; a swipe across its title bar brings the next or the previous window
to the front. The dock lies along the bottom, scrolls sideways when its
icons overflow, stays while windows stand at their own heights, goes when
a window fills the screen (ryOS hides it after four seconds; Tanmai asked
where it went, so ours stays), and comes back on a tap of the grip left at the bottom edge, or a swipe up from it; the swipe from the very edge is the phone's own home gesture and rarely reaches the page. The menus stand in a strip that scrolls
sideways, with the front app's name in bold. Since 2026-09-18, from a
pass against ryOS's phone and a test of every gesture: the bottom resize
edge is a thumb wide, the top a thin strip above the lights, since a
window lies flush under the menu bar and a strip reaching above the frame
would be under it, and a double-tap on either makes the window as tall as
the desktop; a filled window is pulled down by its bar under a finger as under
a pointer; a fill and a swipe buzz; the dock and its grip rise with the
keyboard; a window opens flush under the bar; a long press on a Files row
names the row, since a touch raises no right-click; the phone's own
copy-and-share callout is off on the chrome; the terminal's and the
Agent's lines reconnect the moment the app comes back from the
background, and a microphone the phone took away is opened again. A
phone turned sideways keeps
its windows whole: under 768px they stay the full width; above it, as on
a tablet, they are ordinary windows.

Every window, at every size, wears ryOS's Aqua Glass: a 24px title bar
with its name at 13, the three traffic lights as Aqua orbs that go grey
on a window behind, a 12px radius, and one frosted pane from title bar to
foot, thinner at the top and thinner again behind the front window.

## Why

Tanmai tried the one-app shell on his phone and did not like it; he
looked at ryOS (github.com/ryokun6/ryos) and asked for its mobile version
entirely, "where each window is minimum width the full width of the
screen and then some recommended height and can we make it taller or
shorter", in both orientations, down to the radius of its windows and
its traffic lights. ryOS's answer is the simpler one: one desktop, one
set of windows, one set of rules that bends on a phone rather than a
second interface.

## Ported, and from where

Each mechanism is ryOS's, with its numbers:

- Full width, 8px in, x pinned to 0, y never above the menu bar, at
  least 80px on screen: `src/components/layout/window-frame/WindowFrame.tsx:268,277,309`,
  `src/hooks/useWindowManager.ts:298-306`.
- No snap zones on a phone: `useWindowManager.ts:301`.
- Top and bottom resize handles only, thicker for a thumb; side and
  corner handles hidden below md: `window-frame/WindowFrameResizeHandles.tsx:44-72`.
- Double-tap within 300ms fills the screen:
  `window-frame/hooks/useWindowFrameMaximize.ts:233-269`.
- Swipe of 100px across the title bar switches windows, with a 10px
  nudge over 0.1s: `src/hooks/useSwipeNavigation.ts:80-118`,
  `window-frame/hooks/useWindowFramePhoneSwipe.ts`,
  `window-frame/windowFrameUtils.ts:10-25`.
- Dock goes when a window fills the screen (ryOS: after 4 seconds),
  scrolls sideways, and comes back
  on a swipe up of 48px (12px or less is a tap) that starts in the zone
  along the bottom edge, the dock's height plus the safe area:
  `src/components/layout/dock/MacDock.tsx:171,307,369-430,799-802`,
  `src/utils/dockRevealGesture.ts`.
- Menus in a sideways-scrolling strip with 24px fades and taps held off
  after a scroll: `src/components/layout/menu-bar/ScrollableMenuWrapper.tsx:100-215`;
  the clock as time alone under 768: `menu-bar/MenuBarClock.tsx:65-70`.
- The phone at 640 and full-width windows at 768:
  `src/hooks/useIsPhone.ts`, `useWindowManager.ts:39`.
- The window's look: `src/styles/themes/aqua-glass.css:190-238`,
  `src/styles/themes/tokens.css:199-204`,
  `window-frame/WindowFrameTitleBar.tsx:213-358`,
  `src/components/shared/TrafficLightButton.tsx:22-51,94-183`.
- The body pinned to the screen and the page's ground: `src/index.css:100-137`.

Two things are ours and not ryOS's: with the keyboard up, the desktop
ends where the keyboard begins, read from the visual viewport, so a
window's bottom, the terminal's keys, the composer, stays reachable; and
the traffic lights keep their red, yellow and green rather than Aqua
Glass's accent-tinted orbs.

## Replaces

The phone shell of `docs/decisions/2026-09-16-you-hold-and-you-talk.md`'s
morning: the home grid, the push and pop, the edge swipe, the handle and
the recents deck. Hold to talk stays as it was, the Agent window's phone
mode.
