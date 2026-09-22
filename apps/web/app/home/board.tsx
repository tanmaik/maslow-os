import { RiApps2Line } from "@remixicon/react";
import Link from "next/link";

import { APPS, appHref } from "@/app/desktop/apps";
import type { Card, Port } from "@/app/desktop/tiles";
import { EagerLink } from "@/components/eager-link";

// A widget's place on the board, from the shares of the desktop it was put
// down at: how many of twelve columns it spans, and how tall it stands.
const span = (w: number) => Math.min(12, Math.max(3, Math.round(w * 12)));
const tall = (h: number) => Math.min(720, Math.max(180, Math.round(h * 800)));

const tile =
  "flex h-full items-center gap-3 rounded-md border border-border p-3 transition-colors duration-150 hover:bg-accent";

// Home: the org's name, then every app the person can open, Maslow's own and then theirs and
// the ones colleagues opened to them, each filling the screen when
// picked; and under them the widgets an agent placed through the brain.
export function Board({
  org,
  widgets,
  ports,
}: {
  org: string;
  widgets: Card[];
  ports: Port[];
}) {
  const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 md:px-8">
      <h1 className="text-xl font-medium text-foreground">{org}</h1>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">Apps</h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {APPS.map(({ mark: Mark, ...a }) => (
            <li key={a.href}>
              <EagerLink href={a.href} className={tile}>
                <Mark className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {a.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.says}
                  </span>
                </span>
              </EagerLink>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">Your apps</h2>
        {ports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. Run something on a port in the Terminal, then name it in
            Ports, and it is here and in the sidebar. An app a colleague shares
            with you is here too.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ports.map((p) => (
              <li key={p.href}>
                <Link
                  href={p.tab ? p.href : appHref(p)}
                  target={p.tab ? "_blank" : undefined}
                  className={tile}
                >
                  {p.face ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.face} alt="" className="size-5 rounded-sm" />
                  ) : (
                    <RiApps2Line className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-sm font-medium text-foreground">
                    {p.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {ordered.length > 0 && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-12">
          {ordered.map((w) => (
            <article
              key={w.id}
              style={{ ["--span" as string]: span(w.w), height: tall(w.h) }}
              className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border md:[grid-column:span_var(--span)]"
            >
              <header className="flex h-7 shrink-0 items-center border-b border-border px-2 text-xs text-muted-foreground">
                <span className="truncate">{w.title}</span>
              </header>
              <iframe
                src={w.href}
                title={w.title}
                className="min-h-0 flex-1 bg-background"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              />
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
