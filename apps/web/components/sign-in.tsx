import type { ReactNode } from "react";

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
      </Door>
    );
  }

  return (
    <Door>
      <p className="text-muted-foreground">
        No identity provider is configured. Pick a person from the pill in the
        corner.
      </p>
      {said && <p className="text-destructive text-sm">{said}</p>}
    </Door>
  );
}

// The sign-in as one card on the canvas.
function Door({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-md pt-[12dvh]">
      <Card className="shadow-float ring-0">
        <CardContent className="space-y-4 px-6 py-2">
          <h1 className="font-serif text-3xl leading-tight italic">Sign in</h1>
          {children}
        </CardContent>
      </Card>
    </main>
  );
}
