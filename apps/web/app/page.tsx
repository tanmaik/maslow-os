import { orgOf } from "@maslow/db/settings";
import { after } from "next/server";

import { Room } from "@/app/room/room";
import { SignIn, notice, type Notice } from "@/components/sign-in";
import { sweepIfDue } from "@/lib/meter";
import { roomOf } from "@/lib/room";
import { principal } from "@/lib/session";

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
  const [{ desktops, ports }, { org }] = await Promise.all([
    roomOf(p),
    orgOf(p),
  ]);
  return (
    <main>
      <h1 className="sr-only">{org.name}</h1>
      <Room desktops={desktops} ports={ports} />
    </main>
  );
}
