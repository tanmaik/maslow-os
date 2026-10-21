"use client";

import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiGlobalLine,
  RiRefreshLine,
} from "@remixicon/react";
import { useState } from "react";

import { BarButton, InBar } from "@/app/desktop/panel";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { InputBase } from "@/components/base/input/input";
import { appAt, appHref, appUrl, DEMO_APPS, REPO } from "@/lib/trial-computer";
import { cx } from "@/utils/cx";

// The trial's browser: the same frame as the live one, showing the apps on
// the pretend computer, each at its own port's address. Any other address
// says what this browser can show. Only a trial loads it.
export function TrialBrowser() {
  const first = DEMO_APPS[0]!;
  const [shown, setShown] = useState(appUrl(first));
  const [url, setUrl] = useState(appUrl(first));
  const [past, setPast] = useState<string[]>([]);
  const [ahead, setAhead] = useState<string[]>([]);
  const [again, setAgain] = useState(0);
  const app = appAt(shown);
  const go = (to: string) => {
    const next = /^https?:\/\//.test(to) ? to : `http://${to}`;
    setPast((p) => [...p, shown]);
    setAhead([]);
    setShown(next);
    setUrl(next);
  };
  const step = (back: boolean) => {
    const from = back ? past : ahead;
    const to = from.at(-1);
    if (!to) return;
    (back ? setPast : setAhead)(from.slice(0, -1));
    (back ? setAhead : setPast)((p) => [...p, shown]);
    setShown(to);
    setUrl(to);
  };
  return (
    <div
      className={cx(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default",
        "[html[data-framed]_&]:rounded-none [html[data-framed]_&]:border-0",
      )}
    >
      <InBar
        name={false}
        leading
        phone="strip"
        as={(controls) => (
          <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-separator-border px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {controls}
          </div>
        )}
      >
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <PillTabList aria-label="Tabs">
            <span className="flex max-w-[180px] min-w-0 items-center">
              <PillTab
                variant="blue"
                isSelected
                onSelect={() => {}}
                className="min-w-0 shrink"
              >
                <span className="block truncate">{app?.title ?? shown}</span>
              </PillTab>
            </span>
          </PillTabList>
        </div>
      </InBar>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-separator-border px-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) go(url.trim());
          }}
        >
          <BarButton
            icon={RiArrowLeftLine}
            label="Back"
            onClick={() => step(true)}
          />
          <BarButton
            icon={RiArrowRightLine}
            label="Forward"
            onClick={() => step(false)}
          />
          <BarButton
            icon={RiRefreshLine}
            label="Reload"
            onClick={() => setAgain((n) => n + 1)}
          />
          <InputBase
            size="small"
            aria-label="Address"
            leadingIcon={RiGlobalLine}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="An address"
            autoComplete="off"
            spellCheck={false}
            fieldClassName="h-6 min-w-0 flex-1 rounded-full bg-background-secondary-default focus-within:ring-border-focus-ring"
          />
        </form>
      </div>
      <div className="relative min-h-0 flex-1 bg-background-primary-default">
        {app ? (
          <iframe
            key={`${app.slug}-${again}`}
            src={appHref(app)}
            title={app.title}
            className="absolute inset-0 size-full"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <RiGlobalLine
              className="size-8 text-foreground-icon-tertiary"
              aria-hidden
            />
            <p className="text-body-medium text-text-secondary">
              The trial&rsquo;s browser shows only the apps on this computer:{" "}
              {DEMO_APPS.map((a, i) => (
                <span key={a.slug}>
                  {i > 0 && ", "}
                  <button
                    type="button"
                    className="text-text-primary underline underline-offset-2"
                    onClick={() => go(appUrl(a))}
                  >
                    {appUrl(a)}
                  </button>
                </span>
              ))}
              .
            </p>
            <p className="text-body-regular text-text-tertiary">
              On your own Maslow it is a real browser.{" "}
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                className="text-text-primary underline underline-offset-2"
              >
                Run your own
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
