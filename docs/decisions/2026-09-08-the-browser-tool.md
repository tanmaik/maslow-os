# 2026-09-08 — the browser tool

Claude Code on a person's computer gets a browser the way it gets any
tool: an MCP server, `packages/browser`, driving Playwright's Chromium.
Its tools are Claude in Chrome's, by the same names and shapes, so an agent
that knows one knows the other and what we learn using the one on a Mac
carries to the one on the machine. The page comes back as numbered refs,
one element a line, and `find` locates an element from words, so the
weakest model we serve can act on a page without coordinates. Every answer
is a few lines ending in the tab's title and address, and a failure is one
line. The profile lasts, so logins stick. Chromium lets one browser hold a
profile at a time, so a second server started beside a first gets a fresh
profile for its own life and says so in its first answer: usable, with
logins that do not outlast it, rather than a failure to start.

**Why.** Tanmai: the browser tools have to be powerful enough to navigate a
whole page holistically with the best model and the worst one alike. A
tool built for the weakest model is one the strongest uses well; the
reverse is not true.

**Checked how.** `pnpm check:browser` serves five small pages and does
four tasks on them — a search, a table lookup, a sign-in, a popover with
an off-screen button — tool call by tool call, then every other tool
once: screenshot, zoom, upload, JavaScript, console, network, tabs, a
batch, a recording, a wrong ref. No model drives it; Tanmai chose not to
have model runs in a check. It is its own check, not yet in `pnpm check`,
because it fetches Chromium.

**What it does not do.** No screen: Chromium runs headless, so screenshots
are for the agent, not for a person to watch. Watching and taking over is a
later step. Nothing of ours is on the machine yet; this is the package and
its check.

**The exception.** Playwright fetches its Chromium from Microsoft's own
servers, not from npm. It is the one download outside the registry, and
it is written in `docs/dependencies.md`.
