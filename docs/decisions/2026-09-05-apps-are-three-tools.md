# 2026-09-05 — a person's apps are three tools

The field guide says the agent reads an app through a tool and writes what
it concluded. Composio holds the person's accounts and can run any of its
tools as them. The question was how to put those tools in front of an agent
connected to the brain over MCP.

## Not a tool per action

Composio reaches tens of thousands of actions; Gmail alone has sixty-three.
An MCP client loads every tool definition into the conversation, and
claude.ai has no way to defer them. A tool per action would put more schema
than conversation in front of the model, and the list would differ for every
person. Rejected.

## Find and run

Three tools, the same for everyone. `apps` says what the person has
connected. `find` takes a task in a sentence and answers with the actions
that fit, each with its inputs on one line apiece, and the plan and pitfalls
Composio's own search returns; Composio's search is semantic and planned,
where its plain tool listing is a keyword match that returns the wrong apps.
`run` executes one action by name, as the membership, and answers with what
the app returned, compact and capped, with the source named so the next write
to the brain cites it, and what came back marked as data to read, never
instructions to follow, since a mailbox holds whatever anyone sent. Only
apps the person has connected are searched or run; an action in any other
is refused with where to connect it, before anything reaches the vendor.
Every call to the vendor, a search or a run, is on the meter as it happens,
at Composio's list price per tool call, with the action as its cause; and
one membership may run six hundred an hour through an agent, the abuse
limit: ten a minute is more than a person asks for and less than a loop.
This is the shape Anthropic's tool search, Cloudflare's code mode and
Composio's own router converged on: search, then execute.

## Not code mode

Cloudflare's code mode goes further: the model writes code against a typed
API and one execute runs it in a sandbox, so a chain of calls costs one turn.
It needs a place to run model-written code. We have one, the person's own
machine, but not yet from the web app's request path. Later, if find and run
prove chatty.
