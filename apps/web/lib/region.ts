import { cloud } from "./cloud.ts";
import type { Place } from "./clouds.ts";

// Where a computer can be: the regions this deployment's cloud makes
// disks in. The nearest to the person is guessed once, at the sign-in that
// claims their computer, said on the Computer page beside the round trip
// they measure, and moved to only by them.

export const isRegion = (v: unknown): v is string =>
  typeof v === "string" && Object.hasOwn(cloud.regions, v);

// A region's name in words; a code the cloud no longer offers stays a code.
export const regionName = (code: string) =>
  isRegion(code) ? cloud.regions[code].name : code;

// Kilometres between two places on the earth.
function km([la1, lo1]: Place["at"], [la2, lo2]: Place["at"]): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((la2 - la1) * r) / 2) ** 2 +
    Math.cos(la1 * r) *
      Math.cos(la2 * r) *
      Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// The cloud's first region, taken when nothing nearer is known.
const first = () => Object.keys(cloud.regions)[0]!;

// The region nearest a place.
function nearest(from: Place["at"]): string {
  let best = first();
  for (const [code, place] of Object.entries(cloud.regions))
    if (km(from, place.at) < km(from, cloud.regions[best].at)) best = code;
  return best;
}

// Where a request came from: the address it arrived from, the city Vercel
// puts that address in, the region nearest to it, and every region a
// computer can be in, code to name, for the page to offer. Off Vercel the
// server and the person are the same laptop, so the nearest region is
// the one the cloud says is nearest this server, when it can say; with
// nothing to go on, it is the cloud's first.
export async function whereFrom(h: Headers): Promise<{
  ip: string;
  city: string | null;
  region: string;
  regions: Record<string, string>;
}> {
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "your own machine";
  const regions = Object.fromEntries(
    Object.entries(cloud.regions).map(([code, place]) => [code, place.name]),
  );
  const city = h.get("x-vercel-ip-city");
  const lat = Number(h.get("x-vercel-ip-latitude"));
  const lon = Number(h.get("x-vercel-ip-longitude"));
  if (h.has("x-vercel-ip-latitude") && Number.isFinite(lat + lon))
    return {
      ip,
      city: city && decodeURIComponent(city),
      region: nearest([lat, lon]),
      regions,
    };
  const edge = await cloud.edge();
  return {
    ip,
    city: null,
    region: isRegion(edge) ? edge : first(),
    regions,
  };
}

// The region for a request, for the sign-in that claims a computer.
export const regionFor = async (request: Request) =>
  (await whereFrom(request.headers)).region;
