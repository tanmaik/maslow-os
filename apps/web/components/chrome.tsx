import { waiting } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { membershipsByEmail } from "@maslow/db/auth";
import { orgOf } from "@maslow/db/settings";

import { EagerLink } from "@/components/eager-link";
import { Tabs } from "@/components/tabs";
import { Button } from "@/components/ui/button";
import { You } from "@/components/you";
import { initials } from "@/lib/initials";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// What floats over every signed-in screen: the org and who is in it, the
// four places in the house, how much waits on you, and you in the corner.
export async function Chrome() {
  const p = await principal();
  if (!p) return null;
  const [{ org, members }, memberships, open] = await Promise.all([
    orgOf(p),
    membershipsByEmail(p.email),
    asPerson(p, waiting),
  ]);
  const me = members.find((m) => m.id === p.userId);
  const others = memberships.filter((m) => m.userId !== p.userId);

  return (
    <>
      <header className="pointer-events-none sticky top-0 z-40 flex flex-wrap items-center gap-2 py-6">
        <div className="shadow-float pointer-events-auto flex h-10 max-w-full items-center gap-2.5 rounded-full bg-card pr-3.5 pl-2">
          {org.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={storage.url(org.logoKey)}
              alt=""
              className="size-6 rounded-lg object-cover"
            />
          ) : (
            <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-lg text-xs font-semibold">
              {initials(org.name)}
            </span>
          )}
          <span className="truncate text-sm font-semibold">{org.name}</span>
          <span className="text-muted-foreground text-[13px] whitespace-nowrap">
            {members.length} {members.length === 1 ? "person" : "people"}
          </span>
        </div>
        <Tabs />
        {open > 0 && (
          <Button
            variant="outline"
            className="shadow-float pointer-events-auto h-10 gap-2 border-0 bg-card px-3.5 text-[13px]"
            nativeButton={false}
            render={<EagerLink href="/brain" />}
          >
            <span className="bg-primary size-2 rounded-full" />
            {open} waiting on you
          </Button>
        )}
      </header>
      {me && (
        <div className="pointer-events-none fixed right-6 bottom-6 z-40">
          <You
            name={me.name}
            email={me.email}
            picture={me.avatarKey ? storage.url(me.avatarKey) : null}
            others={others}
          />
        </div>
      )}
    </>
  );
}
