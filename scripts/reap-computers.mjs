// The hourly reap of computers outside production: a machine nobody has
// wanted for an hour is stopped, one nobody has wanted for a day is
// destroyed with its disk, a disk an hour old that no machine holds goes
// too, and what the cloud alone leaves behind goes with them. It reads
// the cloud's own lists, never ours, so nothing forgotten escapes it, and
// it ends with a count.
//
//   node scripts/reap-computers.mjs [--checkout NAME]   also destroy NAME's now
import { cloudOf, wantedAt } from "./cloud.mjs";

const cloud = cloudOf();
const { destroy, destroyVolume, machines, stop, untouchable, volumes } = cloud;

const HOUR = 60 * 60_000;
const gone = process.argv.indexOf("--checkout");
const checkout = gone > 0 ? process.argv[gone + 1] : null;

const now = Date.now();
let stopped = 0;
let destroyed = 0;
let leased = 0;
const all = await machines();
for (const m of all) {
  const tags = m.tags;
  // A machine of production is nobody's to reap, whatever list it is on.
  if (untouchable(m)) continue;
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
      if (m.running) {
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

// A disk made for a machine never made, or left when a destruction was cut
// off, is on no machine; it goes once it is an hour old.
let disks = 0;
const held = new Set((await machines()).flatMap((m) => m.disks));
for (const v of await volumes()) {
  // A disk of production is nobody's to reap, as its machine is not.
  if (held.has(v.id) || v.held || untouchable(v)) continue;
  const age = now - v.madeAt.getTime();
  if (age < HOUR) continue;
  try {
    await destroyVolume(v.id);
    disks++;
    console.log(
      `destroyed disk ${v.id} (${v.name}): ${Math.round(age / HOUR)} h old, on no machine`,
    );
  } catch (err) {
    console.error(`reap disk ${v.id}: ${err.message}`);
  }
}
// What the cloud alone leaves behind, which no row and no disk names.
let left = 0;
for (const thing of await cloud.leftovers()) {
  try {
    await thing.take();
    left++;
    console.log(`took ${thing.what}`);
  } catch (err) {
    console.error(`reap ${thing.what}: ${err.message}`);
  }
}

console.log(
  `reap on ${cloud.name}: ${all.length} machine${all.length === 1 ? "" : "s"}, ${leased} leased, ${stopped} stopped, ${destroyed} destroyed, ${disks} disk${disks === 1 ? "" : "s"} taken, ${left} left behind taken`,
);
