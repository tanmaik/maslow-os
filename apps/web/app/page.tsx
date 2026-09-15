import { asPerson } from "@maslow/db";
import { arrivalOf } from "@maslow/db/arrival";
import { orgOf } from "@maslow/db/settings";
import { after } from "next/server";

import { Room } from "@/app/room/room";
import { LockScreen } from "@/components/lock-screen";
import { SignIn, notice, type Notice } from "@/components/sign-in";
import { membershipsByEmail } from "@maslow/db/auth";
import { deployment } from "@/lib/deployment";
import { sweepIfDue } from "@/lib/meter";
import { roomOf } from "@/lib/room";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// Home is the room: the desk, the whole screen arranged as you left it,
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
  const [
    { desktops, ports, wallpaper },
    { org, members },
    memberships,
    { arrived, owed },
  ] = await Promise.all([
    roomOf(p),
    orgOf(p),
    membershipsByEmail(p.email),
    asPerson(p, arrivalOf),
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
    return <LockScreen step="choose" landings={memberships} you={you} />;
  return (
    <main>
      <h1 className="sr-only">{org.name}</h1>
      <Room
        desktop={desktops[0]!}
        ports={ports}
        wallpaper={wallpaper}
        computers={deployment.computers.kind !== "none"}
        arrival={!arrived}
        owed={owed}
        you={
          you && {
            ...you,
            others: memberships.filter((m) => m.userId !== p.userId),
          }
        }
      />
    </main>
  );
}
