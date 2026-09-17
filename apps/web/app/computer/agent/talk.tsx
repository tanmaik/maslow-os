"use client";

import { RiKeyboardLine } from "@remixicon/react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { VoiceBeam } from "voice-glow";

import type { Chat } from "@/app/computer/agent/chats";
import type { Ear } from "@/app/computer/agent/ear";
import { Markdown } from "@/components/markdown";
import { cx } from "@/utils/cx";

// A hold shorter than this is a tap, which says how the button works
// rather than sending a word.
const TAP = 350;
// How far past the button's edge the thumb may wander before letting go
// means cancel.
const SLACK = 28;

// Voice mode: the thread as a caption, the last thing said and, above it
// small, the work under way; and under them the one big button. The thumb
// holds, the words land as they are heard, the thumb lifts and they go.
// Slide off before lifting and nothing is sent.
export function Talk({
  chat,
  ear,
  note,
  onSay,
  onType,
}: {
  chat: Chat | null;
  ear: Ear;
  // Why nothing can be said right now, when nothing can: the computer
  // out of reach, or a word refused.
  note: string | null;
  onSay: (text: string) => void;
  onType: () => void;
}) {
  const still = useReducedMotion();
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [hint, setHint] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const since = useRef(0);

  // What the caption shows when nobody is talking: the agent's last line,
  // or the person's own words while the agent is still on them.
  const items = chat?.items ?? [];
  const lastSaid = [...items].reverse().find((i) => i.kind === "said");
  const lastPerson = items
    .map((i) => i.kind === "said" && i.who === "person")
    .lastIndexOf(true);
  const work = items
    .slice(lastPerson + 1)
    .reverse()
    .find((i) => i.kind === "tool");
  const running = chat?.running ?? false;
  const level = useRef(0);
  level.current = ear.level;

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    button.current?.setPointerCapture(e.pointerId);
    since.current = Date.now();
    setHint(false);
    setLeaving(false);
    setHeld(true);
    navigator.vibrate?.(8);
    void ear.start();
  };
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!held) return;
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    setLeaving(Math.hypot(dx, dy) > r.width / 2 + SLACK);
  };
  const up = () => {
    if (!held) return;
    setHeld(false);
    const short = Date.now() - since.current < TAP;
    if (leaving || short) {
      ear.cancel();
      setLeaving(false);
      if (short) setHint(true);
      return;
    }
    navigator.vibrate?.(8);
    void ear.stop().then((text) => text && onSay(text));
  };

  const caption = ear.on ? (
    <p className="text-title-3-medium text-text-primary">
      {ear.heard || <span className="text-text-tertiary">Listening…</span>}
    </p>
  ) : lastSaid?.kind === "said" && lastSaid.who === "agent" ? (
    <Markdown className="text-body-regular text-text-primary [&_p]:text-body-regular">
      {lastSaid.text}
    </Markdown>
  ) : lastSaid?.kind === "said" ? (
    <p className="text-body-regular text-text-secondary">{lastSaid.text}</p>
  ) : (
    <p className="text-body-regular text-text-tertiary">
      Hold the button and say what happened, or what you want.
    </p>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-y-auto px-5 pb-4">
        {work?.kind === "tool" && (
          <p className="flex items-center gap-2 text-caption-1-regular text-text-tertiary">
            {running && (
              <span
                aria-hidden
                className={cx(
                  "size-1.5 shrink-0 rounded-full bg-accent-500",
                  !still && "animate-pulse",
                )}
              />
            )}
            <span className="truncate">
              {work.call.title.replace(/^mcp__(\w+?)__(\w+)$/, "$1 › $2")}
            </span>
          </p>
        )}
        <div
          data-caption
          className="max-h-[50dvh] overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_12%)]"
        >
          {caption}
        </div>
      </div>
      {/* The button: a wide slab of the accent with a hairline of light
          along its top edge, its words fading up into it as the screen
          settles. Under the thumb it darkens a step and a glow breathes
          with the voice; off the edge it greys. */}
      <div className="flex items-center gap-3 px-5 pt-2 pb-5">
        <VoiceBeam
          type="default"
          level={() => level.current}
          processing={running}
          active={!still && (ear.on || running)}
          colorVariant="sunset"
          theme="dark"
          className="min-w-0 flex-1"
        >
          <button
            ref={button}
            type="button"
            aria-label="Hold to talk"
            aria-pressed={held}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onContextMenu={(e) => e.preventDefault()}
            className={cx(
              "relative flex h-[84px] w-full touch-none items-center justify-center rounded-[26px] transition-colors duration-fast ease-plain outline-none select-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2 [-webkit-touch-callout:none]",
              leaving
                ? "bg-background-secondary-default text-text-secondary shadow-none"
                : held
                  ? "bg-accent-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]"
                  : "bg-linear-to-b from-accent-500 to-accent-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_10px_30px_-12px_var(--color-accent-600)]",
            )}
          >
            <motion.span
              key={
                (ear.why ?? note)
                  ? "why"
                  : leaving
                    ? "cancel"
                    : held
                      ? "held"
                      : hint
                        ? "hint"
                        : "rest"
              }
              initial={still ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="flex items-center gap-2.5 text-title-3-medium"
              aria-live="polite"
            >
              {(ear.why ?? note) ? (
                <span className="px-6 text-center text-body-medium">
                  {ear.why ?? note}
                </span>
              ) : leaving ? (
                "Release to cancel"
              ) : held ? (
                <>
                  <span aria-hidden className="flex h-5 items-end gap-[3px]">
                    {[0.5, 1, 0.7, 0.9].map((h, k) => (
                      <span
                        key={k}
                        className="w-[3px] rounded-full bg-white/90 transition-[height] duration-100"
                        style={{
                          height: `${6 + h * (4 + ear.level * 14)}px`,
                        }}
                      />
                    ))}
                  </span>
                  Listening
                </>
              ) : hint ? (
                "Hold, talk, let go"
              ) : (
                "Hold to talk"
              )}
            </motion.span>
          </button>
        </VoiceBeam>
        <button
          type="button"
          aria-label="Type instead"
          title="Type instead"
          onClick={onType}
          className="flex size-[52px] shrink-0 items-center justify-center rounded-[18px] bg-background-secondary-default text-foreground-icon-primary transition-colors duration-fast ease-plain hover:bg-background-secondary-hover"
        >
          <RiKeyboardLine className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
