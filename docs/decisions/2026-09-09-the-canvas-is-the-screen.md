# 2026-09-09 — the canvas is the screen

The screen is a canvas, dark and warm, with a faint grid of dots, and the
chrome floats over it in pills. There is one look and no light one. Top
left sit the org with its logo and how many people are in it, the four
places in the house, Team, Brain, Computer and Settings, and, when there is
anything, how much waits on you. Bottom right is you: your picture or your
initials, and under it the other orgs you are in, a new org, and the way
out. Team is home. The sign-in and the home page are each one card on the
ground; every other page keeps its shape and takes the ground's colours
from the same tokens. The typefaces are Instrument Sans and Instrument
Serif; the serif is for a title.

## Why

Tanishk brought a design, the Team Canvas, drawn from the backend rather
than from the pages that were there: "The canvas is the screen; chrome
floats. Dark, warm, quiet. Everything on it is one of three things the
system already has: a live app on someone's computer, a record in a brain,
or the agent's browser." The room, which is Team, is where those three
things are seen together, and the rest of the house is drawn in the same
language. This change is the language: the ground, the chrome and the
tokens every page inherits.

## Waiting on you

The pill counts what asks something of you and is still there: today the
agent's open asks to share, and later the pages teammates' agents put in
front of you. A record a colleague shares with you is knowledge, not a
demand: it shows in your brain and counts for nothing here. Nothing
records whether you opened any of it. Tanishk: "'waiting on you' can just
be the amount of things you haven't addressed, not the amount of things
you haven't opened." Addressing something is the business of whoever put
it in front of you: the ask is answered, the page is taken back, and the
count falls.

## Fonts

The two faces come from npm, as `@fontsource-variable/instrument-sans` and
`@fontsource/instrument-serif`, and ship inside the bundle. Nothing is
fetched from a font host at build or at run: cloud agent sandboxes allow
package registries and deny most other hosts, so a font fetched at build
would fail exactly where it is least visible.

## What it does not do

No prompt bar to your computer: there is no channel to Claude Code on the
machine yet, and a bar that reaches nothing is decoration. No live pages
from anyone's computer in the room: a share does not yet reach a port. The
browser page leaves the tabs and stays reachable from the Computer page.
