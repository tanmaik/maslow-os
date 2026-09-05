import type { Principal } from "@placeholder/db/auth";
import { randomUUID } from "node:crypto";

import { type Account, type App, composio } from "./composio.ts";
import { deployment } from "./deployment.ts";

// A person's connections to outside apps, as Composio holds them. The
// Composio user is the membership. The fake has a few pretend apps whose
// sign-in is a redirect straight back, and keeps its accounts in this
// process.

export type Connection = Account & { appName: string };

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
      status: "ACTIVE",
      createdAt: new Date(),
    });
    return Promise.resolve(
      `${callbackUrl}?status=success&connected_account_id=${id}`,
    );
  },
  accountsOf(userId: string): Promise<Account[]> {
    if (deployment.connections.kind === "composio")
      return composio.accountsOf(userId);
    return Promise.resolve(
      [...pretend.values()].filter((a) => a.userId === userId),
    );
  },
  remove(id: string): Promise<void> {
    if (deployment.connections.kind === "composio") return composio.remove(id);
    pretend.delete(id);
    return Promise.resolve();
  },
};

// An app's name, asked of the catalog once per process.
const names = new Map<string, Promise<string>>();
function nameOf(slug: string): Promise<string> {
  let found = names.get(slug);
  if (!found) {
    found = vendor.app(slug).then((a) => a?.name ?? slug);
    found.catch(() => names.delete(slug));
    names.set(slug, found);
  }
  return found;
}

// A sign-in the person walked away from is not a connection.
const begun = (a: Account) => !["INITIALIZING", "INITIATED"].includes(a.status);

export const connections = {
  // Whether this deployment can connect apps at all.
  get enabled() {
    return deployment.connections.kind !== "none";
  },

  search: (query: string) => vendor.search(query.trim()),

  // The membership's connections, live from the vendor, oldest first.
  async list(p: Principal): Promise<Connection[]> {
    const accounts = (await vendor.accountsOf(p.userId)).filter(begun);
    accounts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.all(
      accounts.map(async (a) => ({ ...a, appName: await nameOf(a.app) })),
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
