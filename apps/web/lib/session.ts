import {
  createSession,
  deleteSession,
  resolveSession,
  type Principal,
  type Session,
} from "@maslow/db/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cache } from "react";

import { claim } from "./computer.ts";
import { cookie, FLOW, SESSION, SESSION_LIFETIME } from "./cookie.ts";
import { regionFor } from "./region.ts";

// What a sign-in remembers between its two legs: the email a code was sent
// to, and where it was going.
export type Flow = { email: string; next?: string };

// A place on this site a sign-in may come back to: a path, never another
// host.
const PATH = /^\/(?!\/)/;

// Where a sign-in ends up: the path it was asked to come back to, or home.
export function destination(home: string, next: unknown): string {
  return typeof next === "string" && PATH.test(next) ? `${home}${next}` : home;
}

// The same place, with one thing to say on arrival.
export const noticed = (to: string, notice: string) =>
  `${to}${to.includes("?") ? "&" : "?"}${notice}`;

// Who the current request acts as, or null when nobody is signed in. Looked
// up once per request, however many components ask. A session an app holds
// opens the brain, never the site.
export const principal = cache(
  async (): Promise<Omit<Session, "client"> | null> => {
    const s = await resolveSession((await cookies()).get(SESSION)?.value);
    return s && s.client === null ? s : null;
  },
);

// Opens a session for p and sends the browser to `to` holding it, having
// claimed their computer in the region the request came from. If the
// membership was removed in the meantime, the browser goes there as it was.
export async function signedIn(
  p: Principal,
  to: string,
  request: Request,
): Promise<Response> {
  const token = await createSession(p);
  if (token) await claim(p, await regionFor(request));
  const response = NextResponse.redirect(to, 303);
  if (token) response.cookies.set(SESSION, token, cookie(SESSION_LIFETIME));
  response.cookies.delete(FLOW);
  return response;
}

// Ends the current session and sends the browser to `to` without it.
export async function signedOut(to: string): Promise<Response> {
  await deleteSession((await cookies()).get(SESSION)?.value);
  const response = NextResponse.redirect(to, 303);
  response.cookies.delete(SESSION);
  return response;
}

// Sends the browser to `to` remembering the first leg of a sign-in.
export function continuing(to: string | URL, flow: Flow): Response {
  const response = NextResponse.redirect(to, 303);
  response.cookies.set(FLOW, JSON.stringify(flow), cookie(10 * 60));
  return response;
}

// Sends the browser to `to` having forgotten any sign-in in progress.
export function abandoned(to: string): Response {
  const response = NextResponse.redirect(to, 303);
  response.cookies.delete(FLOW);
  return response;
}

// The sign-in in progress, or null when there is none or the cookie is not
// one of ours.
export async function pendingFlow(): Promise<Flow | null> {
  const raw = (await cookies()).get(FLOW)?.value;
  if (!raw) return null;
  try {
    const flow = JSON.parse(raw) as Partial<Flow>;
    if (typeof flow.email === "string")
      return {
        email: flow.email,
        ...(typeof flow.next === "string" && PATH.test(flow.next)
          ? { next: flow.next }
          : {}),
      };
  } catch {}
  return null;
}
