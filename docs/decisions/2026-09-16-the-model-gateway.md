# 2026-09-16 — every model call goes through us

Supersedes the rule in `2026-09-07-the-computer-returns.md` that model
calls never route through us.

## What

The agent on a person's computer sends every model call to this
deployment's gateway, `/model`, and never to OpenRouter. The machine
carries no key: it holds the gateway's address and a token of its
computer's own, the computer's id and a mark signed with the secret only
our server and that machine hold. The gateway looks the computer up by
the token, refuses a token that is not that computer's or whose member
is gone, puts the one model we run on the call whatever was asked for,
sends it on with the OpenRouter key that computer's row holds, and
streams the answer back as it comes.

The key is still minted per computer against the weekly cap in dollars,
and OpenRouter still enforces the cap on the key. What changes is where
the key lives: on the row, and nowhere else.

Where a machine cannot dial the deployment, as on a laptop, the call goes
to the machine's own door, up the line the laptop's stack already holds
open for the brain, and streams back down it as a head, its chunks and
an end. Production and previews dial the gateway directly.

## Why

Tanmai, 2026-09-16: "so the openrouter key is nowhere on the computer
that the user can access right?" It was. The key sat in the environment
of the agent's process, which runs as the person, so `env` in the Agent
window read it back, and with it any OpenRouter model was reachable up
to the cap. Then: "can they just query through us, we will be the ai
gateway ... and we will monitor all the usage, and we will give everyone
the 5 a week of usage."

## What it costs

A call through a function on Vercel takes a body of a few megabytes at
most, so the agent's context is held to a quarter of a million tokens
where the model itself takes a million. A call may stream for five
minutes. Should either bind, the gateway moves to the relay machine
each environment already runs, which has neither limit.

## Not

The gateway does not meter per call: OpenRouter's record of the key is
still what the sweep copies into the ledger every hour, and the cap is
OpenRouter's. A person who reads the token out of their own process can
spend their own week on our one model through our gateway, and nothing
else.
