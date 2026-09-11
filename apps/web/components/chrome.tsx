import { BellIcon } from "@heroicons/react/24/solid";
import { waiting } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { membershipsByEmail } from "@maslow/db/auth";
import { orgOf } from "@maslow/db/settings";

import { EagerLink } from "@/components/eager-link";
import { Button } from "@/components/ui/button";
import { You } from "@/components/you";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// What floats over every signed-in screen: how much waits on you, and you,
// bottom right, or top right on a phone where the toolbar has the bottom.
// It never hides, because a finger has no hover to find it with.
export async function Chrome() {
  const p = await principal();
  if (!p) return null;
  const [{ members }, memberships, open] = await Promise.all([
    orgOf(p),
    membershipsByEmail(p.email),
    asPerson(p, waiting),
  ]);
  const me = members.find((m) => m.id === p.userId);
  const others = memberships.filter((m) => m.userId !== p.userId);

  return (
    <div className="app-dock pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end px-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:top-0 max-sm:bottom-auto max-sm:pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto">
        {open > 0 && (
          <Button
            variant="outline"
            size="icon"
            aria-label={`${open} waiting on you`}
            className="bg-card relative size-12 shrink-0 rounded-full"
            nativeButton={false}
            render={<EagerLink href="/brain" />}
          >
            <BellIcon className="size-[18px]" />
            <span className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full text-[10px] font-semibold">
              {open}
            </span>
          </Button>
        )}
        {me && (
          <div className="bg-card shrink-0 rounded-full border p-1">
            <You
              name={me.name}
              email={me.email}
              picture={me.avatarKey ? storage.url(me.avatarKey) : null}
              others={others}
            />
          </div>
        )}
      </div>
    </div>
  );
}
