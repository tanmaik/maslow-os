// The computer's daemon. It has no public address; it reports on itself
// to us on boot and every five minutes: how full its disk is, which is
// mounted at /data. Fly sets FLY_MACHINE_ID; we set the secret and where
// to report when the machine is made.
import { statfs } from "node:fs/promises";

const { COMPUTER_SECRET, REPORT_URL, FLY_MACHINE_ID } = process.env;
if (!COMPUTER_SECRET || !REPORT_URL || !FLY_MACHINE_ID) {
  console.error(
    "A computer needs COMPUTER_SECRET, REPORT_URL and FLY_MACHINE_ID.",
  );
  process.exit(1);
}

async function report() {
  const s = await statfs("/data").catch(() => null);
  const disk = s
    ? { used: (s.blocks - s.bfree) * s.bsize, total: s.blocks * s.bsize }
    : { used: 0, total: 0 };
  try {
    const res = await fetch(REPORT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${COMPUTER_SECRET}`,
        "fly-machine-id": FLY_MACHINE_ID,
        "content-type": "application/json",
      },
      body: JSON.stringify({ disk }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error(`report answered ${res.status}`);
  } catch (err) {
    console.error(`report failed: ${err.message}`);
  }
}

await report();
setInterval(report, 5 * 60 * 1000);
