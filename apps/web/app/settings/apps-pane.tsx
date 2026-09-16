import type { Principal } from "@maslow/db/auth";

import { connections } from "@/lib/connections";

import { Connections } from "./connections";
import type { Told } from "./told";

// The Apps pane asks the vendor itself, so the rest of Settings never
// waits on it: the pane streams in behind its skeleton.
export async function AppsPane({
  p,
  focus,
  said,
}: {
  p: Principal;
  focus: string | null;
  said: Told;
}) {
  const unanswered = (err: Error) => {
    console.error(`connections: ${err.message}`);
    return null;
  };
  const [connected, mostUsed] = connections.enabled
    ? await Promise.all([
        connections.list(p).catch(unanswered),
        connections.search("").catch(unanswered),
      ])
    : [[], []];
  return (
    <Connections
      enabled={connections.enabled}
      connections={connected}
      mostUsed={mostUsed}
      focus={focus}
      said={said}
    />
  );
}
