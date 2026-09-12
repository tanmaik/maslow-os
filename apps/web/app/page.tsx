import { waiting } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { membershipsByEmail } from "@maslow/db/auth";
import { orgOf } from "@maslow/db/settings";
import { after } from "next/server";

import { Room } from "@/app/room/room";
import { SignIn, notice, type Notice } from "@/components/sign-in";
import { deployment } from "@/lib/deployment";
import { sweepIfDue } from "@/lib/meter";
import { roomOf } from "@/lib/room";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// Home is the room: desktops you swipe between, each the whole screen
// arranged as you left it, and a toolbar of building blocks to drag onto
// them. Signed out, a way in.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Notice>;
}) {
  const said = notice(await searchParams);
  const p = await principal();
  if (!p) return <SignIn said={said} />;
  // A look at the site is what runs the hourly sweep outside production.
  after(() => sweepIfDue());
  const [{ desktops, ports }, { org, members }, memberships, open] =
    await Promise.all([
      roomOf(p),
      orgOf(p),
      membershipsByEmail(p.email),
      asPerson(p, waiting),
    ]);
  const me = members.find((m) => m.id === p.userId);
  return (
    <main>
      <h1 className="sr-only">{org.name}</h1>
      <Room
        desktops={desktops}
        ports={ports}
        waiting={open}
        computers={deployment.computers.kind !== "none"}
        you={
          me && {
            name: me.name,
            email: me.email,
            picture: me.avatarKey ? storage.url(me.avatarKey) : null,
            others: memberships.filter((m) => m.userId !== p.userId),
          }
        }
      />
    </main>
  );
}
