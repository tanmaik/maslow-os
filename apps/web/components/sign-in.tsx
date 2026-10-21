import { orgs } from "@maslow/db/seed";
import type { ReactNode } from "react";

import { LockScreen, type Made } from "@/components/lock-screen";
import { deployment } from "@/lib/deployment";
import { pendingFlow } from "@/lib/session";

// What the last leg of a sign-in left to say, by the query it redirected
// with. `orgs` is not a notice: it says the person who just signed in has
// more than one org to land in.
export type Notice = {
  email?: "slow" | "rejected" | "closed";
  code?: "wrong" | "locked";
  orgs?: string;
};

const NOTICES = {
  "email=slow": "Too many codes asked for. Wait ten minutes and try again.",
  "email=rejected": "That address was refused. Check it and try again.",
  "email=closed":
    "Maslow is invite-only for now. Someone already in can invite you.",
  "code=wrong": "That code didn't work. Try again or start over.",
  "code=locked": "Too many wrong codes. Ask for a new one.",
} as const;

// The one line the last leg left behind, if any.
export function notice(n: Notice): string | null {
  for (const [k, v] of Object.entries(n))
    if (`${k}=${v}` in NOTICES)
      return NOTICES[`${k}=${v}` as keyof typeof NOTICES];
  return null;
}

// The seeded people, as the development way in lists them. A person can be
// a member of two orgs, and on a card that shows only a name and an address
// they read as the same row twice; theirs says which org it is for.
function made(): Made[] {
  const seen = new Map<string, number>();
  for (const org of orgs)
    for (const u of org.users) seen.set(u.email, (seen.get(u.email) ?? 0) + 1);
  return orgs.map((org) => ({
    org: org.name,
    people: org.users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      email:
        (seen.get(u.email) ?? 0) > 1 ? `${u.email} · ${org.name}` : u.email,
    })),
  }));
}

// A way in: the lock screen, on whichever leg the sign-in is on. Given
// somewhere to go next, it comes back there when it is done; otherwise it
// lands home. `because` says what asked for it, for a person who arrived
// here from somewhere they did not choose.
export async function SignIn({
  said,
  next,
  because,
}: {
  said: string | null;
  next?: string;
  because?: ReactNode;
}) {
  const emails = deployment.identity.kind === "workos";
  const flow = emails ? await pendingFlow() : null;
  return (
    <LockScreen
      step={flow ? "code" : "who"}
      email={flow?.email}
      said={said}
      locked={said === NOTICES["code=locked"]}
      next={next}
      because={because}
      emails={emails}
      noMail={deployment.mail.kind === "none"}
      made={deployment.seededSignIn ? made() : undefined}
      plain={deployment.production}
    />
  );
}

// Every step of the way in that is not the lock screen, as one card in the
// middle of the page: a title, a line under it, and what to do. The app
// asking in and the request that cannot be answered are both this shape and
// this width.
export function Door({
  title,
  description,
  because,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  because?: ReactNode;
  children?: ReactNode;
}) {
  return (
    // The page's own content box, less the gutters the layout keeps: the
    // card sits in the middle of it and the page never scrolls. A card
    // taller than that scrolls within the page, top first.
    <main className="h-[calc(100dvh-8.5rem)] overflow-y-auto">
      <div className="flex min-h-full items-center justify-center px-4 py-6">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-card">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-title-3-medium text-text-primary">{title}</h1>
            <p className="text-body-regular text-text-secondary">
              {because ? <>{because} </> : null}
              {description}
            </p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
