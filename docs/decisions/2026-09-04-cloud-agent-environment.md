# 2026-09-04 — the Cloud Agent environment

The environment that lets a Cursor Cloud Agent run this repo, committed to
`.cursor/` so it follows branches and pull requests like everything else. Two
things found by running it against a real cloud box, and what was decided.

## The base image pins Node 24, because the default box is too old

A cloud agent's default box ships Node 22.14. The repo imports TypeScript
directly (`import "./seed.ts"`), which needs the native type-stripping that
arrives in Node 22.18 and is on by default in Node 24 — so on the default box
`pnpm smoke` dies with `ERR_UNKNOWN_FILE_EXTENSION ".ts"` before it can prove
anything. `.node-version` already says 24; `.cursor/Dockerfile` makes the box
match it (`node:24-bookworm-slim`), so the floor is met before any code runs.
The embedded Postgres carries its own libraries, so the slim Debian base needs
nothing beyond what the Node image already has.

## Commands put Node 24 first on PATH, because the daemon injects an older one

The agent's own Node (22.14) sits on `PATH` ahead of the image's, so a bare
`pnpm` in `install` or the `dev` terminal would run under it and hit the same
`.ts` failure. Each command prepends `/usr/local/bin` — where the image's Node
24 lives — so the pinned Node wins wherever the command runs. It is harmless
when the image's Node is already first.
