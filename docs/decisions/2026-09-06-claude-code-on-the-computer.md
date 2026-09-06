# Claude Code on the computer, and no chat page

2026-09-06

The agent page is gone: the conversation list, the streamed chat, the
process the daemon ran per conversation, the adapter package on the image,
the conversation tables, and the wakeup and subagent bookkeeping. The agent
is Claude Code, run from the terminal on the person's computer. What the
page did, Claude Code does better on its own: its transcripts are files in
the home, resumed with `--resume`, backed up with everything else.

**Why.** The page was a copy of t3code's layout over an adapter over the
Claude Agent SDK, kept in step with two moving projects, and every feature
Claude Code shipped had to be rebuilt in it: wakeups, subagents, permission
modes. Tanmai: why build a chat page at all when the computer already runs
the real thing. The product is the computer, the brain, the meter and the
sharing around them; the agent is a program on the computer, like any other.

**Claude Code ships with the daemon.** It is a dependency of the daemon's
package, installed into the image with it and bound into the operating
system at `/opt/maslow` on every boot, ahead of the system's own on the
path. So a new image is a new Claude Code on every computer, which a copy
installed into the operating system on first boot never was, and a copy the
person installs in their home still comes first.

**Models are reached through a gateway in the app.** The machine holds no
vendor key. Every shell carries the gateway's address and the machine's
own credential as the bearer token Claude Code sends, so `claude` needs no
sign-in; the app swaps the vendor's key in, streams the answer back, and
reads every call's tokens off the events as they pass. Metering happens
where the money is spent, and a person with root on their machine cannot
read the org's key. One model is offered, GLM through OpenRouter, and the
gateway refuses a call naming any other before it costs. Claude Code is
told what to make of a model it does not know by a managed setting the
daemon writes on every boot, with the Claude it behaves as and its window.
OpenRouter is asked for each call's exact price afterwards, and the meter
takes that over the list price; a call the app lost track of is settled by
the sweep as it stood and marked lost, so the gap is seen rather than
silent. The org has a cap a month and a person a cap an hour, both checked
at the door from the same rows.

**The brain is in Claude Code's settings.** The daemon writes the brain's
MCP door into `~/.claude.json` at every boot, knocked on as the machine,
which the door lets in as the person the machine belongs to. The person may
change the rest of their settings; that one entry comes back at boot.

**The fake is a fallback.** Without a model key the gateway answers from a
pretend model outside production, so the terminal and the smoke work with
nothing spent; production without a key boots with no model.

**Rejected.** Running t3code on the machine behind a port link: it would
have been the third application beside the terminal, with its own state
format to read for the ledger, for a page the terminal already gives.

**Deferred.** Picking the machine's region from where the person signs in;
the transcript as something the ledger can search; reconciling
`model_calls` against OpenRouter's invoice.
