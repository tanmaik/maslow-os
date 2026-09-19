import { orgOf } from "@maslow/db/settings";
import { after } from "next/server";

import { ChatsProvider } from "@/app/computer/agent/chats";
import { Desktop } from "@/app/desktop/desktop";
import { LockScreen } from "@/components/lock-screen";
import { SignIn, notice, type Notice } from "@/components/sign-in";
import { membershipsByEmail } from "@maslow/db/auth";
import { deployment } from "@/lib/deployment";
import { sweepIfDue } from "@/lib/meter";
import { desktopOf } from "@/lib/desktop";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// Home is the room: the desktop, the whole screen arranged as you left it,
// and a dock of blocks to open on it. Signed out, a way in.
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
  const [{ desktops, ports, wallpaper }, { org, members }, memberships] =
    await Promise.all([desktopOf(p), orgOf(p), membershipsByEmail(p.email)]);

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
  return (
    <main>
      <h1 className="sr-only">{org.name}</h1>
      <ChatsProvider>
        <Desktop
          desktop={desktops[0]!}
          ports={ports}
          wallpaper={wallpaper}
          computers={deployment.computers.kind !== "none"}
          you={
            you && {
              ...you,
              others: memberships.filter((m) => m.userId !== p.userId),
            }
          }
        />
      </ChatsProvider>
    </main>
  );
}
