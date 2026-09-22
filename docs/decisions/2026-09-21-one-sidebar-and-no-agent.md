# 2026-09-21 — one sidebar, and no Agent of ours

Maslow is a sidebar and one thing on the screen. The sidebar names every
place, Home, Database, Files, Terminal, Browser and Ports, then the
person's apps, then Notifications, Settings and the person. What is picked
fills the rest of the screen. Home is the list of apps: Maslow's own, then
the person's and the ones colleagues shared with them. A phone has the
same places as tabs along the bottom.

Maslow has no Agent of its own. The Agent window, its conversations, the
model gateway at `/model`, the OpenRouter key minted per person, the
weekly cap, hold to talk and Deepgram, the Agent pane of Settings, the
door's Agent socket, `claude-code-acp`, the `wakeup` and `stop` tools,
managed auth and the skills linked into it are gone, from the web app,
the door and the image, and the iPhone app.

What stays: the terminal, with the person's own Claude Code the word
`claude` away on their own account; the browser; Files; ports, apps and
every kind of sharing; the brain and its MCP server at `/mcp`, with
`notify`, `ask`, `open`, `desktop`, `place`, `unplace` and `share`, which
the person's own Claude Code and any agent they connect still use.

## Why

Tanmai, 2026-09-21: the dock and the menu bar did not work, the repo had
become hard to follow, and the product has to be something two founders
can use between themselves for the next weeks of building. One list of
apps, each filling the screen, is the whole interface. An agent of ours
was the largest part of the code and the least used; a person's own
Claude Code in the terminal does the work, and reaches the brain and the
browser through the two MCP servers the computer seeds for it.

## What it does not do

No table changes shape. The columns that held a computer's model key, its
spend and its week, the `reply_to` of a notification and the unused
`model_calls` table stay in the database, unread, since production's data
is not to be touched in this change; a later migration drops them. Keys
already minted at OpenRouter are deleted there by hand.
