"use client";

import type { App } from "@/lib/composio";
import { RiSearchLine } from "@remixicon/react";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { Spinner } from "@/components/ui/spinner";
import { initials } from "@/lib/initials";

import { Row, Rows } from "./row";

// Finds an app to connect as the person types; before they type, the apps
// most people connect. Null for the vendor's most used means it did not
// answer.
export function Finder({ mostUsed }: { mostUsed: App[] | null }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<App[] | null>(mostUsed);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(mostUsed);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const wait = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(
          `/settings/connections/apps?q=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        );
        const apps = res.ok ? ((await res.json()) as App[]) : null;
        if (controller.signal.aborted) return;
        setFound(apps);
        setBusy(false);
      } catch {
        if (!controller.signal.aborted) {
          setFound(null);
          setBusy(false);
        }
      }
    }, 250);
    return () => {
      clearTimeout(wait);
      controller.abort();
    };
  }, [query, mostUsed]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-sm">
        <InputBase
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an app to connect"
          aria-label="Find an app to connect"
          leadingIcon={RiSearchLine}
        />
        {busy && (
          <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 text-foreground-icon-tertiary" />
        )}
      </div>
      {found === null ? (
        <p className="text-body-2-regular text-text-secondary">
          Composio didn&apos;t answer, so no apps can be found right now. Try
          again in a moment.
        </p>
      ) : found.length === 0 ? (
        <p className="text-body-2-regular text-text-secondary">
          No app matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <Rows>
          {found.map((a) => (
            <Row
              key={a.slug}
              label={
                <span className="flex items-center gap-2.5">
                  <Avatar
                    size="sm"
                    src={a.logo ?? undefined}
                    initials={initials(a.name)}
                    className="rounded-md"
                  />
                  <span className="min-w-0 truncate text-body-regular text-text-primary">
                    {a.name}
                  </span>
                </span>
              }
            >
              <form action="/settings/connections" method="post">
                <input type="hidden" name="intent" value="connect" />
                <input type="hidden" name="app" value={a.slug} />
                <Button size="small" variant="secondary" type="submit">
                  Connect
                </Button>
              </form>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}
