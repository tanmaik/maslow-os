import { relay } from "./index.ts";

// The relay as a process: its port and the secret it shares with the app
// from the environment, and how often it asks after people, for a check
// that cannot wait a minute.
const port = Number(process.env.SYNC_PORT);
const secret = process.env.SYNC_SECRET;
if (!port || !secret) throw new Error("SYNC_PORT and SYNC_SECRET are needed");
const recheck = Number(process.env.SYNC_RECHECK_MS) || undefined;
await relay({ port, secret, recheck }).listen();
console.log(`sync      ws://127.0.0.1:${port}`);
