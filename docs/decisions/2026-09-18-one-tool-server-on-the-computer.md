# 2026-09-18 — one tool server on the computer

The Agent on a computer has two MCP servers: the computer's own, and the
brain. The computer's is the browser it always was, with two guides beside
it, `boardui` and `widget`, and a note in the Agent's own directory tells
it what this computer is and to use them. BoardUI's own MCP server is no
longer given to it.

## Why

Tanmai, 2026-09-18: the agent should know to use BoardUI; bring the
browser tools and the BoardUI tools together; put a tool in there for how
to make widgets; consolidate the whole thing to make it easy.

Three servers were one too many. BoardUI's own MCP server ran `npx
boardui@latest mcp` at every start, reaching the registry and duplicating
what the skill already held in the image; the Agent had no word telling
it to use any of it, and nothing said how a widget is made from a port and
the brain's `place`.

## What it is

- **`computer`**, `packages/browser`, on the machine at 8082: the browser's
  tools as they were, and `boardui`, which answers with BoardUI's rules,
  or a topic of its catalog, patterns, theming or motion, the catalog
  searched by a word so a 60-kilobyte file is never handed over whole, and
  `widget`, which answers with the six steps from an empty folder to a
  placed widget. Both read files the image carries, named to the server
  by the boot; anywhere else they say they are not on this computer.
- **A note of ours, `CLAUDE.md` in `~/.maslow/claude`**, written from the
  image at every boot: what this computer is, the two servers, call
  `boardui` before a screen and `widget` before the desktop, `notify` and
  `ask` for the person. Nothing of it is in the person's own `~/.claude`.
- **Installing stays the CLI.** `npx boardui@latest add <name>` writes the
  components; the guide names it, and no server does it.

## Later that day

Tanmai: the only configuration of ours on the person's own Claude Code
should be the same two servers, the brain and the computer with every
tool made for this agent, the browser and BoardUI included. So the two
servers are seeded into their `~/.claude.json` and kept current there,
theirs to change or remove; the mode, the skill link and the model stay
out, as #279 settled.

## Later still

Tanmai: the computer is a merge of BoardUI, our skill explaining how the
system functions, a skill on how to build apps, a skill on how to use the
MCP, and the browser tools. So the guides are four, each a tool that
answers with one file the image carries: `maslow`, `apps` (which took in
`widget`), `brain` and `boardui`. The note in the Agent's own directory
names when to read each.
