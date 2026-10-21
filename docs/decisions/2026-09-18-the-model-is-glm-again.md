# 2026-09-18 — the model is GLM 5.3 Flash again, thinking least

The one model behind the gateway is `z-ai/glm-5.3-flash:nitro` once more,
on whichever of its providers is fastest, and every call still carries
`reasoning: { effort: "none" }`. GPT-5.6 Luna, the one model since earlier
today, is gone after a few hours.

## Why

Tanmai, 2026-09-18: "we have to go back to glm-5.3-flash."

Luna's sessions on his computer were full of failed tool calls. Read from
the Agent's own transcripts under `~/.maslow/claude/projects`:

- Luna fills every optional field of a tool call. It sent `pages: ""` on
  Read, which Read refuses, and because it issues a dozen Reads and Globs
  in one turn, the one refusal failed every sibling with it: of the 23
  failed calls in one subagent, 16 were "Sibling tool call errored".
- Its streams through OpenRouter dropped mid-answer: eleven "Request was
  aborted" in one session, each falling back to a non-streaming retry.

GLM's sessions before today show neither.

## What it is

- The gateway sets the model and the reasoning on every call and strips
  what a caller sent for either, so the choice is the deployment's and not
  Claude Code's. GLM 5.3 Flash lists `reasoning` among what it takes, so
  the least is asked of it as it was of Luna.
- Every name Claude Code offers in its own model picker points at the
  same id, as before.
- The door names a chat with the same model.
- The Agent window's composer names no model: the choice is the deployment's,
  not the person's to pick or to be told.
