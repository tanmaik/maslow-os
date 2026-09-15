// Where a computer can be: the seven places in North America Fly still
// makes disks in. Fly retires regions now and then, and one it retired
// refuses a new disk, so the list is what Fly offers and no more. The nearest to the person is guessed once,
// at the sign-in that claims their computer, said on the Computer page
// beside the round trip they measure, and moved to only by them.

type Place = readonly [number, number];

export const REGIONS = {
  iad: { name: "Ashburn", at: [38.9, -77.04] },
  ord: { name: "Chicago", at: [41.88, -87.63] },
  dfw: { name: "Dallas", at: [32.78, -96.8] },
  lax: { name: "Los Angeles", at: [34.05, -118.24] },
  ewr: { name: "Newark", at: [40.74, -74.17] },
  sjc: { name: "San Jose", at: [37.34, -121.89] },
  yyz: { name: "Toronto", at: [43.65, -79.38] },
} as const satisfies Record<string, { name: string; at: Place }>;

export type Region = keyof typeof REGIONS;

export const isRegion = (v: unknown): v is Region =>
  typeof v === "string" && v in REGIONS;

// A region's name in words; a code from before these stays a code.
export const regionName = (code: string) =>
  isRegion(code) ? REGIONS[code].name : code;

// A round trip feels like a terminal under this many milliseconds.
export const BUDGET_MS = 40;

// Kilometres between two places on the earth.
function km([la1, lo1]: Place, [la2, lo2]: Place): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((la2 - la1) * r) / 2) ** 2 +
    Math.cos(la1 * r) *
      Math.cos(la2 * r) *
      Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// The region nearest a place.
function nearest(from: Place): Region {
  let best: Region = "iad";
  for (const code of Object.keys(REGIONS) as Region[])
    if (km(from, REGIONS[code].at) < km(from, REGIONS[best].at)) best = code;
  return best;
}

// Where a request came from: the address it arrived from, the city Vercel
// puts that address in, and the region nearest to it. Off Vercel the
// server and the person are the same laptop, so the nearest region is the
// Fly edge that answers it, when that edge is one of these; a place
// none of these is near is Ashburn.
export async function whereFrom(h: Headers): Promise<{
  ip: string;
  city: string | null;
  region: Region;
}> {
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "your own machine";
  const city = h.get("x-vercel-ip-city");
  const lat = Number(h.get("x-vercel-ip-latitude"));
  const lon = Number(h.get("x-vercel-ip-longitude"));
  if (h.has("x-vercel-ip-latitude") && Number.isFinite(lat + lon))
    return {
      ip,
      city: city && decodeURIComponent(city),
      region: nearest([lat, lon]),
    };
  try {
    const res = await fetch("https://debug.fly.dev", {
      signal: AbortSignal.timeout(3_000),
    });
    const edge = res.headers.get("fly-region");
    if (isRegion(edge)) return { ip, city: null, region: edge };
  } catch {}
  return { ip, city: null, region: "iad" };
}

// The region for a request, for the sign-in that claims a computer.
export const regionFor = async (request: Request) =>
  (await whereFrom(request.headers)).region;
