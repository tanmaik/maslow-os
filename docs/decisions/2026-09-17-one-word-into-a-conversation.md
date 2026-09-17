# One word into a conversation

2026-09-17. Decided by Tanmai on 2026-09-16, built the next morning.

## What

Every word that reaches a conversation on a person's computer goes
through one function of the door's, `chatWord`, whoever says it: the
person at the Agent window, an answer they gave behind the clock, a
wakeup firing, a watched command's lines. It goes into the record in
their words. With no turn running it is a turn of its own. With one
running it goes into that turn: at once while the agent is thinking, and
once the tool it is running has answered if one is, since a tool cut off
midway is work lost. Into the turn means the turn is stopped where it
stands and prompted on with the word, as Claude Code's own terminal does
with a word typed while it works. What is held for a turn that ends
before the tool does goes on as the turn's continuation, so nothing said
is lost and the window's prompt is answered by the end of the whole of
it.

A question the agent asks the person is one ask of the brain's, left
with `reply_to`, the conversation it came from. Claude Code's own
AskUserQuestion is handed to the door by the adapter patch, the door
leaves one ask per question, and the tool is refused with the ids and
the word that the answer arrives as the next message, so the turn ends.
The ask stands in the thread and behind the clock alike; answered in
either, the app says the answer back to the door, `/maslow/say`, which
puts it into the conversation as the next word and takes the ask off
the thread. An ask left by any other client, with no `reply_to`, is as
it was: read back with `notifications`.

The door's tools are two: `wakeup`, a delay with a prompt or a command
to watch with a pattern, and `stop`. Claude Code's own background shell
and subagents stay its own within a turn.

## Why

Steering was one message behind: a word pushed into the adapter's raw
input queue was read as the next turn's prompt, after the running one
ended. A question blocked the turn until answered, so a person away from
the window left their agent hanging, and an ask left through the brain
and a question asked through the tool were two things in two places.
Three door tools with overlapping words were one too many.

## Not

Nothing on the machine calls home. The door reaches the brain the way
the machine's own `ask` does, through the address it was given.
