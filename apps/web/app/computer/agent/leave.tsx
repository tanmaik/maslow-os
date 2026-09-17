"use client";

import type { Ask } from "@/app/computer/agent/chats";
import { ANSWER, ASK_SAID } from "@/app/computer/agent/thread";
import { PhoneSheet, SheetRow } from "@/app/desktop/sheet";

// What the agent asks before it acts, on a phone: a sheet from the bottom
// edge saying what kind of thing in plain words, the thing itself as it
// would run, and the answers as rows a thumb can hit. A question it asks
// the person comes the same way, its options the rows.
export function AskSheet({
  ask,
  onAnswer,
}: {
  ask: Ask | null;
  onAnswer: (ask: Ask, result: unknown) => void;
}) {
  // The thing itself: a command without the backticks Claude Code wraps
  // it in, or a tool named as its server's, brain › search.
  const what = (ask?.title.replace(/^`+|`+$/g, "").trim() ?? "").replace(
    /^mcp__(\w+?)__(\w+)$/,
    "$1 › $2",
  );
  return (
    <PhoneSheet
      open={ask !== null}
      onClose={() => {}}
      label={
        ask?.asked ? "Your agent asks" : (ASK_SAID[ask?.kind ?? "other"] ?? "")
      }
    >
      {ask && (
        <p
          className={
            ask.asked
              ? "px-4 py-3 text-body-medium text-text-primary"
              : "px-4 py-3 font-mono text-body-2-regular break-all text-text-secondary"
          }
        >
          {what}
        </p>
      )}
      {ask?.asked?.body && (
        <p className="px-4 pb-3 text-body-2-regular whitespace-pre-line text-text-tertiary">
          {ask.asked.body.replace(/^- /gm, "")}
        </p>
      )}
      <div className="bg-separator-border my-1 h-px" />
      {ask?.asked
        ? ask.asked.choices.map((o) => (
            <SheetRow key={o} onClick={() => onAnswer(ask, o)}>
              {o}
            </SheetRow>
          ))
        : ask?.options.map((o) => (
            <SheetRow
              key={o.optionId}
              onClick={() =>
                onAnswer(ask, {
                  outcome: { outcome: "selected", optionId: o.optionId },
                })
              }
            >
              {ANSWER[o.kind] ?? o.name}
            </SheetRow>
          ))}
    </PhoneSheet>
  );
}
