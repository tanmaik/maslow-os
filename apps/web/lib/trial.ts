import { reapTrials } from "@maslow/db/trials";

import { TRIAL_HOURS } from "./trial-rules.ts";

// Trial orgs a day old go, with everything in them. Run by the sweep, at
// the server's start and every hour after; a failure is said and the next
// hour tries again.
export async function reap(): Promise<number> {
  try {
    const gone = await reapTrials(TRIAL_HOURS);
    if (gone) console.log(`trial: ${gone} org(s) a day old deleted`);
    return gone;
  } catch (err) {
    console.error(`trial reap: ${(err as Error).message}`);
    return 0;
  }
}
