# 2026-09-05 — what a review walks

`REVIEW.md` is the hand-held half of the merge gate: the lines never
crossed, what every pull request is checked for, and what has gone wrong
before. It was written from the code and from two days of session
transcripts, and it grows the same way the field guide does — one entry as
a thing is actually found.

## Unused code is a check

`pnpm unused` runs knip over the workspaces and fails on an unused file,
export, type or dependency. It is part of `pnpm check`, so it holds main.
Every tsconfig also refuses an unused local or parameter. The shadcn
catalogue under `apps/web/components/ui` is an entry point, since every
component is installed whether or not a page has reached for it yet;
`agentation-mcp` is kept for the developer's own MCP config. Both are said
in `knip.jsonc`, which is the only place an exception lives.

## A pull request is read by the person running the company

The title says what changed for the person using the product, in one plain
sentence. The description says what changed, why, what to check, and what
it does not do, each as a short list of facts. The same rule holds for what
an agent says to the founder: plain words, a term explained where it first
appears, and a recap at the end that stands alone.
