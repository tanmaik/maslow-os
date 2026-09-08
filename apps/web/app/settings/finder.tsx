"use client";

import type { App } from "@/lib/composio";
import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { initials } from "@/lib/initials";

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
    <div className="space-y-3">
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an app to connect"
          aria-label="Find an app to connect"
          className="pl-8"
        />
        {busy && (
          <Spinner className="text-muted-foreground absolute top-1/2 right-2.5 -translate-y-1/2" />
        )}
      </div>
      {found === null ? (
        <p className="text-muted-foreground text-sm">
          Composio didn&apos;t answer, so no apps can be found right now. Try
          again in a moment.
        </p>
      ) : found.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No app matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ItemGroup className="gap-0">
          {found.map((a) => (
            <Item key={a.slug} size="sm">
              <ItemMedia>
                <Avatar className="size-8 rounded-md">
                  {a.logo && <AvatarImage src={a.logo} alt="" />}
                  <AvatarFallback className="rounded-md">
                    {initials(a.name)}
                  </AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{a.name}</ItemTitle>
                {a.description && (
                  <ItemDescription className="line-clamp-1">
                    {a.description}
                  </ItemDescription>
                )}
              </ItemContent>
              <ItemActions>
                <form action="/settings/connections" method="post">
                  <input type="hidden" name="intent" value="connect" />
                  <input type="hidden" name="app" value={a.slug} />
                  <Button size="sm" variant="outline" type="submit">
                    Connect
                  </Button>
                </form>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
