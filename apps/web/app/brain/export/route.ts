import { exportBrain } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";

import { principal } from "@/lib/session";

// The signed-in person's brain as a downloadable file.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });

  const snapshot = await asPerson(p, (db) => exportBrain(db));
  return new Response(JSON.stringify(snapshot, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="brain.json"',
    },
  });
}
