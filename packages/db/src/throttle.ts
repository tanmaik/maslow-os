import { asThrottle } from "./index.ts";

const COUNT = `insert into throttles (key, hits, window_start) values ($1, 1, now())
   on conflict (key) do update set
     hits = case when throttles.window_start < now() - $2 * interval '1 second'
       then 1 else throttles.hits + 1 end,
     window_start = case when throttles.window_start < now() - $2 * interval '1 second'
       then now() else throttles.window_start end
   returning hits`;

// Counts a hit against key and says whether it is still within `limit` hits
// per `windowSeconds`. The window restarts once it has fully passed.
export async function allow(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  return asThrottle(key, async (q) => {
    const hits = (await q.query<{ hits: number }>(COUNT, [key, windowSeconds]))
      .rows[0]!.hits;
    return hits <= limit;
  });
}

// Forgets a key, so its next hit starts a fresh window.
export async function clear(key: string): Promise<void> {
  await asThrottle(key, (q) =>
    q.query("delete from throttles where key = $1", [key]),
  );
}
