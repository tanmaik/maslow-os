"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChatHeader } from "@/components/agent/chat-header";
import { Composer, type ModelOption } from "@/components/agent/composer";

// A conversation not yet begun, as t3code draws a draft: the headline over a
// composer in the middle of the page. Sending makes the conversation and
// opens it with the prompt already on its way.
export function NewConversation({
  models,
  defaultModel,
  faked,
}: {
  models: ModelOption[];
  defaultModel: string;
  faked: boolean;
}) {
  const router = useRouter();
  const [model, setModel] = useState(defaultModel);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (text: string) => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/agent/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        setError((await res.text()) || "The conversation could not be made.");
        setSending(false);
        return;
      }
      const { id } = (await res.json()) as { id: string };
      // Kept for the conversation page in storage, or in the address when
      // storage will not have it, so the first prompt is never lost.
      let carried = false;
      try {
        sessionStorage.setItem(`agent-first-${id}`, text);
        carried = true;
      } catch {}
      router.push(
        carried
          ? `/agent/${id}`
          : `/agent/${id}#first=${encodeURIComponent(text)}`,
      );
      // The sidebar is the layout's; it learns of the new conversation here.
      router.refresh();
    } catch (err) {
      setError((err as Error).message || "The conversation could not be made.");
      setSending(false);
    }
  };

  return (
    <div className="bg-background relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatHeader session={null} title="New conversation" />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center">
          <div className="w-full px-3 sm:px-5">
            <div className="pointer-events-auto relative z-10">
              <div className="absolute inset-x-0 bottom-full z-0">
                <div className="pb-8">
                  <h1 className="text-foreground mx-auto w-full max-w-5xl text-center text-2xl font-normal tracking-tight text-balance sm:text-3xl">
                    What should we build on{" "}
                    <span className="border-foreground/60 border-b border-dotted">
                      your computer
                    </span>
                    ?
                  </h1>
                </div>
              </div>
              <Composer
                models={models}
                model={model}
                onModel={setModel}
                onSend={send}
                disabled={sending}
                working={false}
                autoFocus
              />
              {faked && (
                <p
                  className="text-muted-foreground mx-auto mt-2 max-w-3xl px-4 text-xs"
                  data-faked
                >
                  The agent is faked here: this deployment has no model key.
                </p>
              )}
              {error && (
                <p
                  className="text-destructive mx-auto mt-2 max-w-3xl px-4 text-sm"
                  data-error
                >
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
