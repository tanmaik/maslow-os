# 2026-09-16 — you hold, and you talk

A thumb held on one big button is how a person says anything to their
agent. They talk, they see the words as they land, they let go, and it
goes. What comes back is a line or two of text, never a voice. It is the
one way the things that happen away from a keyboard reach the brain.

## Why

The brain is worth what is in it, and almost nothing that happens to a
person happens at a keyboard. Every system of record fails the same way:
writing into it is work, so it rots, so nothing built on top of it can be
trusted. Tanishk, 2026-09-16, on why his lab abandoned Notion: "it shldnt
feel like a chore."

Typing on a phone is the chore. Holding a button and saying what happened
is not. This is the cheapest way in and the cheapest way to ask, and it
is the same gesture for both.

It is also what stands between the founders and the only evidence that
matters, which is the product working on them every day.

## What it is

- **One button, and it is the biggest thing on the screen.** Voice mode
  is a mode of a chat, not a separate app: the thread is above, in text,
  and the talk button is below and dominant. The hand rests where it is
  used.
- **Hold to talk.** Press and hold, and the words appear as they are
  heard, so the person can see it is getting them. Release sends. There
  is no send button in this mode and no wake word.
- **What comes back is short, and it is text.** A line or two, in the
  register of an answer rather than a document. Nothing is ever spoken
  out loud.
- **The work is shown, small, above the answer.** What the agent is
  doing — a tool it called, a command it ran — sits inline at the top of
  the turn as a line, with a mark that shows it working. The output of
  the work belongs under the call, as it does in the Agent window.
- **The thread is a caption.** What is on screen is the last thing said;
  as more arrives it replaces what was there and scrolls, the way a
  caption does. A person in a gym or on a street reads one line, not a
  transcript.
- **A word lands in a running turn.** Holding and talking again while the
  agent is still working adds what was said to the turn in flight, as
  typing already does in the Agent window. Nothing has to be waited out.
- **Typing is still there.** The keyboard is one tap away and the same
  thread takes both.
- **Every hold is a turn with something that was already alive.** Not a
  session. Each chat is a bot with months behind it, named, picked from
  the rail, and it keeps its own context and compacts itself. The person
  knows who they are talking to.
- **It sends a message to the agent, and nothing more.** Voice is an input
  to the same conversation the keyboard feeds. What the agent does with
  what it hears — what it writes to the brain, what it goes and does — is
  the agent's, as it is for anything else the person says.

## What it is not

- Not spoken aloud, ever, in either direction from the machine.
- Not always listening. There is no wake word and no background mic; a
  browser cannot hold one on a phone and should not.
- Not a transcript on screen. The conversation is kept; the screen shows
  the last line.
- Not a replacement for the Agent window on a desk, which stays a
  conversation with its plan, its steps and its questions.

## How

Speech becomes text at a transcription vendor, behind an interface of
ours like every other vendor, and named in `docs/dependencies.md` in the
commit that adds it. The browser's own `SpeechRecognition`, which the
composer's mic used until this landed, was a toggle and not dependable on
a phone; it went when the vendor landed, so there is one way to turn
speech into text and not two.

Without the vendor's key there is no transcription, the mode says so on
screen for as long as that is true, and the keyboard is where it always
was. Production refuses to start without it.

A phone is the first surface this is built for, and the web app installed
to the home screen is where it runs. Microphone access while the app is
open is all it needs; nothing about it depends on the background.

The vendor is Deepgram, chosen 2026-09-17: words stream back as they are
heard and refine while they are still being said. Our server mints a
token good for a minute; the phone streams its microphone to Deepgram
directly, never through us, as the door's sockets go. Release sends;
slide the thumb off the button before lifting and nothing is sent. On a
phone a chat opens in voice mode, the keyboard one tap away; on a desk
the composer's mic is the same stream, clicked on and off, the words
landing in the field.

## What it unblocks

The founders cannot use their own product daily until saying something to
it costs nothing. Everything downstream — the landing page, the film, the
scores posted publicly, the first hundred people — rests on that daily
use being real. This is the smallest thing that makes it real.
