"use client";

import type { App } from "@/lib/composio";
import { RiSearchLine } from "@remixicon/react";
import { useEffect, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { initials } from "@/lib/initials";

import { Row, Rows } from "./row";

// Finds an app to connect as the person types; before they type, the apps
// most people connect. Null for the vendor's most used means it did not
// answer.
export function AppSearch({ mostUsed }: { mostUsed: App[] | null }) {
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
      <InputGroup className="max-w-sm">
        <InputGroupAddon>
          <RiSearchLine aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an app to connect"
          aria-label="Find an app to connect"
        />
        {busy && (
          <InputGroupAddon align="inline-end">
            <Spinner />
          </InputGroupAddon>
        )}
      </InputGroup>
      {found === null ? (
        <p className="text-sm text-muted-foreground">
          Composio didn&apos;t answer, so no apps can be found right now. Try
          again in a moment.
        </p>
      ) : found.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No app matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <Rows>
          {found.map((a) => (
            <Row
              key={a.slug}
              label={
                <span className="flex items-center gap-2.5">
                  {a.logo ? (
                    <img
                      src={a.logo}
                      alt=""
                      className="size-5 shrink-0 object-contain"
                    />
                  ) : (
                    <Avatar size="sm">
                      <AvatarFallback>{initials(a.name)}</AvatarFallback>
                    </Avatar>
                  )}
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {a.name}
                  </span>
                </span>
              }
            >
              <form action="/settings/connections" method="post" target="_top">
                <input type="hidden" name="intent" value="connect" />
                <input type="hidden" name="app" value={a.slug} />
                <Button size="sm" variant="outline" type="submit">
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
