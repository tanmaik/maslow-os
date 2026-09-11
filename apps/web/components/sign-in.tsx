import { orgs } from "@maslow/db/seed";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deployment } from "@/lib/deployment";
import { pendingFlow } from "@/lib/session";

// What the last leg of a sign-in left to say, by the query it redirected
// with.
export type Notice = {
  email?: "slow" | "rejected";
  code?: "wrong" | "locked";
};

const NOTICES = {
  "email=slow": "Too many codes asked for. Wait ten minutes and try again.",
  "email=rejected": "That address was refused. Check it and try again.",
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

// A way in. Given somewhere to go next, the sign-in comes back there when it
// is done; otherwise it lands home.
export async function SignIn({
  said,
  next,
}: {
  said: string | null;
  next?: string;
}) {
  const { identity } = deployment;
  const onward = next && <input type="hidden" name="next" value={next} />;

  if (identity.kind === "workos") {
    const flow = await pendingFlow();
    const email = flow?.email ?? null;
    return (
      <Door>
        {email ? (
          <>
            {deployment.mail.kind === "none" ? (
              <p className="text-muted-foreground border-l-2 pl-3 text-sm">
                No mail is configured: the code for {email} is in the server's
                terminal.
              </p>
            ) : (
              <p>
                Enter the six-digit code sent to{" "}
                <span className="font-medium">{email}</span>.
              </p>
            )}
            <form action="/auth/code" method="post" className="flex gap-2">
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                autoFocus
                placeholder="000000"
                className="max-w-32"
              />
              <Button type="submit">Continue</Button>
            </form>
            {said && <p className="text-destructive text-sm">{said}</p>}
            <form action="/auth/restart" method="post">
              {onward}
              <Button variant="link" size="sm" type="submit" className="px-0">
                Use a different email
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              We&apos;ll email you a six-digit code. No password, no account to
              make.
            </p>
            {said && <p className="text-destructive text-sm">{said}</p>}
            <form action="/auth/email" method="post" className="flex gap-2">
              {onward}
              <Input
                name="email"
                type="email"
                required
                autoFocus
                placeholder="you@example.com"
              />
              <Button type="submit">Continue</Button>
            </form>
          </>
        )}
        <Seeded next={next} />
      </Door>
    );
  }

  return (
    <Door>
      <p className="text-muted-foreground">
        No identity provider is configured. Sign in as one of the seeded people.
      </p>
      {said && <p className="text-destructive text-sm">{said}</p>}
      <Seeded next={next} />
    </Door>
  );
}

// The way in without an email, outside production: pick one of the seeded
// people. Impossible in production, where the route behind it is not there
// at all, and marked here so nobody mistakes it for the real door.
function Seeded({ next }: { next?: string }) {
  if (!deployment.seededSignIn) return null;
  return (
    <div className="space-y-3">
      <Alert>
        <AlertTitle>Not the real sign-in</AlertTitle>
        <AlertDescription>
          These people are made up, and this way in does not exist in
          production.
        </AlertDescription>
      </Alert>
      {orgs.map((org) => (
        <div key={org.id} className="space-y-1">
          <p className="text-muted-foreground text-sm">{org.name}</p>
          <div className="flex flex-wrap gap-2">
            {org.users.map((u) => (
              <form key={u.id} action="/auth/dev" method="post">
                <input type="hidden" name="user" value={u.id} />
                {next && <input type="hidden" name="next" value={next} />}
                <Button variant="outline" size="sm" type="submit">
                  {u.firstName} {u.lastName}
                </Button>
              </form>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// The sign-in, as one card in the middle of the page.
function Door({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-md pt-[12dvh]">
      <Card className="shadow-float ring-0">
        <CardContent className="space-y-4 px-6 py-2">
          <h1 className="font-semibold">Sign in</h1>
          {children}
        </CardContent>
      </Card>
    </main>
  );
}
