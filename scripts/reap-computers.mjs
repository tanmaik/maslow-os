// The hourly reap of computers outside production: a machine nobody has
// wanted for an hour is stopped, and one nobody has wanted for a day is
// destroyed with its disk. It reads Fly's own list, never ours, so
// nothing forgotten escapes it, and it ends with a count.
//
//   node scripts/reap-computers.mjs [--checkout NAME]   also destroy NAME's now
import { destroy, machines, stop, wantedAt } from "./fly.mjs";

const HOUR = 60 * 60_000;
const gone = process.argv.indexOf("--checkout");
const checkout = gone > 0 ? process.argv[gone + 1] : null;

const now = Date.now();
let stopped = 0;
let destroyed = 0;
let leased = 0;
const all = await machines();
for (const m of all) {
  const tags = m.config?.metadata ?? {};
  const idle = now - wantedAt(m).getTime();
  const who = `${m.id} (${tags.checkout ?? "no checkout"}, ${tags.member ?? "no member"})`;
  try {
    if ((checkout && tags.checkout === checkout) || idle > 24 * HOUR) {
      await destroy(m);
      destroyed++;
      console.log(
        `destroyed ${who}: last wanted ${Math.round(idle / HOUR)} h ago`,
      );
    } else if (idle > HOUR) {
      if (m.state === "started") {
        await stop(m.id);
        stopped++;
        console.log(
          `stopped ${who}: last wanted ${Math.round(idle / HOUR)} h ago`,
        );
      }
    } else leased++;
  } catch (err) {
    console.error(`reap ${who}: ${err.message}`);
  }
}
console.log(
  `reap: ${all.length} machine${all.length === 1 ? "" : "s"}, ${leased} leased, ${stopped} stopped, ${destroyed} destroyed`,
);
