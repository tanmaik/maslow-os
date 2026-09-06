"use client";

import { ArrowUp, ChevronDown, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type ModelOption = { id: string; label: string; claude: boolean };

// Where the person writes, as t3code draws it: a rounded card, the prompt
// above a toolbar with the model on the left and a round send on the right.
// Enter sends, Shift+Enter breaks a line; while the agent works the round
// button stops it.
export function Composer({
  models,
  model,
  onModel,
  onSend,
  onStop,
  disabled = false,
  working,
  placeholder = "Ask anything…",
  autoFocus = false,
  meter,
}: {
  models: ModelOption[];
  model: string;
  onModel: (model: string) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  working: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  // What the conversation has cost, shown beside the send button, and how
  // much of it the vendor served from its cache.
  meter?: { usd: number; tokens: number; cached: number; calls: number };
}) {
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // The prompt takes focus once it can be written in: a field disabled
  // while the machine connects cannot take it at mount. Only where there is
  // a pointer: on a phone, focus would raise the keyboard over the page.
  useEffect(() => {
    if (
      autoFocus &&
      !disabled &&
      matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      box.current?.focus();
  }, [autoFocus, disabled]);
  const canSend = draft.trim().length > 0 && !disabled && !working;
  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
    box.current?.focus();
  };
  const current = models.find((m) => m.id === model);
  return (
    <div className="relative isolate mx-auto w-full max-w-3xl" data-composer>
      <div className="bg-card relative z-10 w-full rounded-[22px] shadow-[0_12px_28px_-18px_rgb(0_0_0/40%)] ring-1 ring-black/8 dark:shadow-none dark:ring-white/5">
        <form
          className="rounded-[21px] p-px"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="px-4 pt-3.5 pb-1">
            <Textarea
              ref={box}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={placeholder}
              aria-label="Prompt"
              disabled={disabled}
              rows={1}
              className="max-h-50 min-h-17.5 resize-none border-0 bg-transparent p-0 text-[14px] leading-relaxed shadow-none focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent"
            />
          </div>
          <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="-m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 ps-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {models.length > 0 ? (
                <Select value={model} onValueChange={(v) => v && onModel(v)}>
                  <SelectTrigger
                    size="sm"
                    aria-label="Model"
                    data-model={model}
                    className="text-muted-foreground hover:text-foreground -ms-2.5 h-7 min-h-7 max-w-48 min-w-0 shrink justify-between gap-1.5 rounded-md border-0 bg-transparent px-2.5 font-medium whitespace-nowrap shadow-none transition-none sm:max-w-56 dark:bg-transparent [&>svg]:hidden"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <SelectValue>{current?.label ?? model}</SelectValue>
                    </span>
                    <ChevronDown
                      aria-hidden
                      className="text-muted-foreground size-3.5 shrink-0"
                      strokeWidth={2.25}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                        {!m.claude && (
                          <span className="text-muted-foreground ms-1 text-xs">
                            not Claude
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-muted-foreground -ms-2.5 h-7 px-2.5 text-[0.8rem] leading-7 font-medium">
                  Faked agent
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
              {meter && meter.calls > 0 && (
                <span
                  className="text-muted-foreground hidden text-xs tabular-nums md:inline"
                  data-spend={meter.usd}
                  title={`${meter.calls} calls to the model, at the vendor's price`}
                >
                  {dollars(meter.usd)} · {meter.tokens.toLocaleString()} tokens
                  {meter.cached > 0 &&
                    ` · ${Math.round((100 * meter.cached) / meter.tokens)}% cached`}
                </span>
              )}
              {working && onStop ? (
                <Button
                  type="button"
                  size="icon-sm"
                  className="size-9 rounded-full transition-[scale] duration-150 ease-out active:scale-[0.96] sm:size-8"
                  onClick={onStop}
                  aria-label="Stop generation"
                  data-stop
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  className={cn(
                    "size-9 rounded-full shadow-xs transition-[scale,opacity] duration-150 ease-out active:scale-[0.96] disabled:opacity-30 disabled:shadow-none sm:size-8",
                  )}
                  disabled={!canSend}
                  aria-label={disabled ? "Not connected" : "Send message"}
                  data-send
                >
                  <ArrowUp className="size-3.5" strokeWidth={2.25} />
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Dollars to the fraction of a cent, as the meter shows them.
const dollars = (n: number) =>
  n < 0.01 && n > 0 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;
