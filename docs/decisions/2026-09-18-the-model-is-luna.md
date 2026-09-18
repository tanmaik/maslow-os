# 2026-09-18 — the model is GPT-5.6 Luna, thinking least

The one model behind the gateway is `openai/gpt-5.6-luna`, and every call
carries `reasoning: { effort: "none" }`, the least the model offers.
GLM 5.3 Flash, the one model since 2026-09-14, is gone.

## Why

Tanmai, 2026-09-18: "change the model to gpt-5.6-luna, the normal version
of it, with the lowest reasoning effort."

## What it is

- The gateway sets the model and the reasoning on every call and strips
  what a caller sent for either, so the choice is the deployment's and not
  Claude Code's.
- Every name Claude Code offers in its own model picker points at the
  same id, as before.
- The door names a chat with the same model.
