import type { Principal } from "@maslow/db/auth";
import { randomUUID } from "node:crypto";

import { type Account, type App, composio } from "./composio.ts";
import { deployment } from "./deployment.ts";

// A person's connections to outside apps, as Composio holds them. The
// Composio user is the membership. A person may hold several accounts in
// one app, each with a name of their own choosing, and the name lives at
// the vendor with the account. The fake has a few pretend apps whose
// sign-in is a redirect straight back to be vouched for, and keeps its
// accounts in this process.

export type Connection = Account & { appName: string; logo: string | null };

const PRETEND: App[] = [
  { slug: "pigeon", name: "Carrier Pigeon", description: "Mail.", logo: null },
  { slug: "sundial", name: "Sundial", description: "Calendar.", logo: null },
  { slug: "abacus", name: "Abacus", description: "Numbers.", logo: null },
];
// The pretend vendor's accounts, kept for the process across reloads.
const shared = globalThis as {
  __accounts?: Map<string, Account & { userId: string }>;
};
const pretend = (shared.__accounts ??= new Map());

// The vendor as this deployment has it: Composio, or the pretend one.
const vendor = {
  search(query: string): Promise<App[]> {
    if (deployment.connections.kind === "composio")
      return composio.search(query);
    const q = query.toLowerCase();
    return Promise.resolve(
      PRETEND.filter(
        (a) => a.name.toLowerCase().includes(q) || a.slug.includes(q),
      ),
    );
  },
  app(slug: string): Promise<App | null> {
    if (deployment.connections.kind === "composio") return composio.app(slug);
    return Promise.resolve(PRETEND.find((a) => a.slug === slug) ?? null);
  },
  link(userId: string, slug: string, callbackUrl: string): Promise<string> {
    if (deployment.connections.kind === "composio")
      return composio.link(userId, slug, callbackUrl);
    const id = `pretend_${randomUUID().slice(0, 8)}`;
    pretend.set(id, {
      id,
      userId,
      app: slug,
      name: null,
      status: "INITIATED",
      createdAt: new Date(),
    });
    return Promise.resolve(
      `${callbackUrl.replace(/callback$/, "verify")}?session_uri=held_${id}`,
    );
  },
  accountsOf(userId: string): Promise<Account[]> {
    if (deployment.connections.kind === "composio")
      return composio.accountsOf(userId);
    return Promise.resolve(
      [...pretend.values()].filter((a) => a.userId === userId),
    );
  },
  rename(id: string, name: string): Promise<boolean> {
    if (deployment.connections.kind === "composio")
      return composio.rename(id, name);
    const held = pretend.get(id)!;
    const taken = [...pretend.values()].some(
      (a) =>
        a.id !== id &&
        a.userId === held.userId &&
        a.app === held.app &&
        a.name === name,
    );
    if (name && taken) return Promise.resolve(false);
    held.name = name || null;
    return Promise.resolve(true);
  },
  remove(id: string): Promise<void> {
    if (deployment.connections.kind === "composio") return composio.remove(id);
    pretend.delete(id);
    return Promise.resolve();
  },
  complete(sessionUri: string, userId: string): Promise<string | null> {
    if (deployment.connections.kind === "composio")
      return composio.complete(sessionUri, userId);
    const held = /^held_pretend_[0-9a-f]{8}$/.test(sessionUri)
      ? pretend.get(sessionUri.slice("held_".length))
      : undefined;
    if (!held || held.status !== "INITIATED") return Promise.resolve(null);
    held.status = held.userId === userId ? "ACTIVE" : "FAILED";
    return Promise.resolve(held.status === "ACTIVE" ? held.id : null);
  },
};

// An app as the catalog describes it, asked once per process; an app the
// catalog no longer lists is its slug.
const apps = new Map<string, Promise<App>>();
function appOf(slug: string): Promise<App> {
  let found = apps.get(slug);
  if (!found) {
    found = vendor
      .app(slug)
      .then((a) => a ?? { slug, name: slug, description: null, logo: null });
    found.catch(() => apps.delete(slug));
    apps.set(slug, found);
  }
  return found;
}

// A sign-in the person walked away from is not a connection.
const begun = (a: Account) => !["INITIALIZING", "INITIATED"].includes(a.status);

// A name is short and on one line.
export const NAME = /^[^\p{Cc}\p{Zl}\p{Zp}]{1,40}$/u;

export const connections = {
  // Whether this deployment can connect apps at all.
  get enabled() {
    return deployment.connections.kind !== "none";
  },

  // The apps that match a search; the most used when it is empty.
  search: (query: string) => vendor.search(query.trim()),

  // The membership's connections, live from the vendor, oldest first.
  async list(p: Principal): Promise<Connection[]> {
    const accounts = (await vendor.accountsOf(p.userId)).filter(begun);
    accounts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.all(
      accounts.map(async (a) => {
        const app = await appOf(a.app);
        return { ...a, appName: app.name, logo: app.logo };
      }),
    );
  },

  // Where the person goes to sign in to an app, or null when there is no
  // such app.
  async connect(
    p: Principal,
    slug: string,
    callbackUrl: string,
  ): Promise<string | null> {
    const app = await vendor.app(slug);
    return app && vendor.link(p.userId, app.slug, callbackUrl);
  },

  // What came of a sign-in: the account, by the id the browser brought back,
  // must be the membership's, and its standing is the vendor's word.
  async confirm(
    p: Principal,
    accountId: string,
  ): Promise<"connected" | "failed" | "gone"> {
    const account = (await vendor.accountsOf(p.userId)).find(
      (a) => a.id === accountId,
    );
    if (!account) return "gone";
    return account.status === "ACTIVE" ? "connected" : "failed";
  },

  // Vouches for who finished a sign-in the vendor is holding: the account
  // activates for this membership and its id is answered, or the sign-in
  // was someone else's, fails, and null is.
  vouch(p: Principal, sessionUri: string) {
    return vendor.complete(sessionUri, p.userId);
  },

  // Names one of the membership's accounts, or clears the name. "taken"
  // when another of their accounts in the app has it; "gone" when the
  // account is not theirs.
  async rename(
    p: Principal,
    accountId: string,
    name: string,
  ): Promise<"renamed" | "taken" | "gone"> {
    const mine = (await vendor.accountsOf(p.userId)).some(
      (a) => a.id === accountId,
    );
    if (!mine) return "gone";
    return (await vendor.rename(accountId, name)) ? "renamed" : "taken";
  },

  // Deletes one of the membership's accounts at the vendor. False when the
  // account is not theirs, or is already gone.
  async disconnect(p: Principal, accountId: string): Promise<boolean> {
    const mine = (await vendor.accountsOf(p.userId)).some(
      (a) => a.id === accountId,
    );
    if (!mine) return false;
    await vendor.remove(accountId);
    return true;
  },

  // Deletes every account of a membership that no longer exists.
  async forgetMember(userId: string): Promise<void> {
    if (deployment.connections.kind === "none") return;
    for (const a of await vendor.accountsOf(userId)) await vendor.remove(a.id);
  },
};
