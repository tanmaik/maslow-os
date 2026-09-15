"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { RadioGroup } from "@/components/base/radio/radio";
import { RadioCard } from "@/components/base/radio/radio-card";
import { Textarea } from "@/components/base/textarea/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MOST, type Mode } from "@maslow/db/arrival";
import type { Progress } from "@/lib/computer";

// An app the person could connect right here, as the Connected apps pane
// would offer it.
export type Offered = { slug: string; name: string };

// The card that meets a person on their first desk, while their computer
// is made behind it: three questions, one at a time, each written into
// what already exists. How much their agent does on its own sets its
// cadence and a paragraph in their own file on their computer; the apps
// it may read are connected as they would be in Settings; what they are
// working toward is what its first run is told. Skipped, it never comes
// back, and every answer is a Settings pane later.
export function Arrival({
  computer,
  onDone,
}: {
  // Where the person's computer stands while the card is up, "off" where
  // this deployment makes none, null before the first ask.
  computer: Progress | "off" | null;
  onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // The apps to offer, the few most connected, asked for once the card is
  // up so the desk never waits on the catalog: undefined until it
  // answers, null when it could not, empty where connections are off.
  const [apps, setApps] = useState<Offered[] | null | undefined>(undefined);
  useEffect(() => {
    let stopped = false;
    fetch("/settings/connections/apps?q=")
      .then(async (r) => {
        if (r.status === 404) return [];
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as Offered[];
      })
      .then(
        (found) => {
          if (!stopped)
            setApps(
              found.slice(0, 4).map(({ slug, name }) => ({ slug, name })),
            );
        },
        () => {
          if (!stopped) setApps(null);
        },
      );
    return () => {
      stopped = true;
    };
  }, []);
  const [mode, setMode] = useState<Mode>("bar");
  const [words, setWords] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  // An answer that did not land keeps the card, and the words, for
  // another try.
  const send = async (m: Mode | "skip", w: string) => {
    setSending(true);
    setFailed(false);
    const res = await fetch("/arrival", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: m, words: w || null }),
    }).catch(() => null);
    if (res?.ok) return onDone();
    setSending(false);
    setFailed(true);
  };
  // Whether there is an apps step: something to offer, a list still on
  // its way, or one that could not be read and is said so.
  const hasApps = apps === undefined || apps === null || apps.length > 0;
  const behind =
    computer === "off"
      ? "Computers are off on this copy of Maslow."
      : computer === "ready"
        ? "Your computer is ready."
        : computer === "disk"
          ? "Making your disk behind this."
          : computer === "machine"
            ? "Making your machine behind this."
            : computer === "starting"
              ? "Starting your computer behind this."
              : "Setting up your computer behind this.";
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !sending && void send("skip", "")}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <div className="flex min-w-0 flex-col gap-4">
          {step === 1 && (
            <>
              <DialogHeader>
                <DialogTitle>
                  How much should your agent do on its own?
                </DialogTitle>
                <DialogDescription>
                  {behind} The cadence is a setting under Computer later; the
                  wish is written into your own CLAUDE.md on your computer,
                  which is yours to edit.
                </DialogDescription>
              </DialogHeader>
              <RadioGroup
                aria-label="How much your agent does on its own"
                value={mode}
                onChange={(v) => setMode(v as Mode)}
              >
                <RadioCard
                  value="desk"
                  title="Arrange my desk"
                  description="Once a day: what matters most, on your desk, as widgets."
                />
                <RadioCard
                  value="bar"
                  title="Tell me in the bar"
                  description="Every half hour: a note behind the clock when something needs you."
                />
                <RadioCard
                  value="off"
                  title="Nothing on its own"
                  description="Only when you ask. Your brain is yours to write by hand."
                />
              </RadioGroup>
              <DialogFooter>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={sending}
                  onClick={() => void send("skip", "")}
                >
                  Skip
                </Button>
                <Button
                  size="small"
                  disabled={sending}
                  onClick={() =>
                    hasApps
                      ? setStep(2)
                      : mode === "off"
                        ? void send("off", "")
                        : setStep(3)
                  }
                >
                  {hasApps || mode !== "off" ? "Next" : "Done"}
                </Button>
              </DialogFooter>
            </>
          )}
          {step === 2 && (
            <>
              <DialogHeader>
                <DialogTitle>Which apps should it read?</DialogTitle>
                <DialogDescription>
                  Each opens the app&rsquo;s own sign-in in a new tab. More are
                  in Settings under Connected apps, any time.
                </DialogDescription>
              </DialogHeader>
              {apps === null && (
                <p className="text-body-2-regular text-text-secondary">
                  The list of apps could not be read just now. Settings under
                  Connected apps has them all, any time.
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {(apps ?? []).map((a) => (
                  <form
                    key={a.slug}
                    action="/settings/connections"
                    method="post"
                    target="_blank"
                    className="contents"
                  >
                    <input type="hidden" name="intent" value="connect" />
                    <input type="hidden" name="app" value={a.slug} />
                    <Button type="submit" variant="secondary" size="small">
                      Connect {a.name}
                    </Button>
                  </form>
                ))}
              </div>
              <DialogFooter>
                <Button variant="ghost" size="small" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  size="small"
                  disabled={sending}
                  onClick={() =>
                    mode === "off" ? void send("off", "") : setStep(3)
                  }
                >
                  {mode === "off" ? "Done" : "Next"}
                </Button>
              </DialogFooter>
            </>
          )}
          {step === 3 && (
            <>
              <DialogHeader>
                <DialogTitle>What are you trying to get to?</DialogTitle>
                <DialogDescription>
                  The next year or two, in your own words. Half-formed is fine;
                  several things is the point. Your agent starts from here.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                size="small"
                aria-label="What you are working toward"
                rows={6}
                value={words}
                onChange={(v) => setWords(v.slice(0, MOST))}
                hint={`${words.length} of ${MOST}`}
                placeholder="Ship the enterprise contract by spring. Run a marathon in October. Get the house sold. Be home for dinner four nights a week."
              />
              <DialogFooter>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => setStep(hasApps ? 2 : 1)}
                >
                  Back
                </Button>
                <Button
                  size="small"
                  disabled={sending}
                  onClick={() => void send(mode, words.trim())}
                >
                  {words.trim() ? "Done" : "Done, nothing for now"}
                </Button>
              </DialogFooter>
            </>
          )}
          {failed && (
            <p className="text-body-2-regular text-text-error-primary">
              That did not save. Try again; what you chose and wrote is still
              here.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
