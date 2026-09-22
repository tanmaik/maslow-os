import { orgOf } from "@maslow/db/settings";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { LockScreen } from "@/components/lock-screen";
import { SignIn, notice, type Notice } from "@/components/sign-in";
import { membershipsByEmail } from "@maslow/db/auth";
import { deployment } from "@/lib/deployment";
import { sweepIfDue } from "@/lib/meter";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// The way in. Signed in, it is Home.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Notice>;
}) {
  const asked = await searchParams;
  const said = notice(asked);
  const p = await principal();
  if (!p) return <SignIn said={said} />;
  // A look at the site is what runs the hourly sweep outside production.
  after(() => sweepIfDue());
  const [{ members }, memberships] = await Promise.all([
    orgOf(p),
    membershipsByEmail(p.email),
  ]);

  const me = members.find((m) => m.id === p.userId);
  const you = me && {
    name: me.name,
    email: me.email,
    picture: me.avatarKey ? storage.url(me.avatarKey) : null,
  };
  // Just signed in with a code, and in more than one org: the last leg of
  // the way in is which one to land in.
  if (asked.orgs && you && memberships.length > 1)
    return (
      <LockScreen
        step="choose"
        landings={memberships}
        you={you}
        plain={deployment.production}
      />
    );
  redirect("/home");
}
