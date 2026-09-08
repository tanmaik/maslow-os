// Where a computer is made: the Fly region nearest the person, decided
// once, at the sign-in that claims it.

// Fly's regions and where they are.
const REGIONS: Record<string, [number, number]> = {
  ams: [52.37, 4.9],
  arn: [59.33, 18.07],
  atl: [33.75, -84.39],
  bog: [4.71, -74.07],
  bom: [19.08, 72.88],
  bos: [42.36, -71.06],
  cdg: [48.86, 2.35],
  den: [39.74, -104.99],
  dfw: [32.78, -96.8],
  ewr: [40.74, -74.17],
  eze: [-34.6, -58.38],
  fra: [50.11, 8.68],
  gdl: [20.66, -103.35],
  gig: [-22.91, -43.17],
  gru: [-23.55, -46.63],
  hkg: [22.32, 114.17],
  iad: [38.9, -77.04],
  jnb: [-26.2, 28.05],
  lax: [34.05, -118.24],
  lhr: [51.51, -0.13],
  mad: [40.42, -3.7],
  mia: [25.76, -80.19],
  nrt: [35.68, 139.69],
  ord: [41.88, -87.63],
  otp: [44.43, 26.1],
  phx: [33.45, -112.07],
  qro: [20.59, -100.39],
  scl: [-33.45, -70.67],
  sea: [47.61, -122.33],
  sin: [1.35, 103.82],
  sjc: [37.34, -121.89],
  syd: [-33.87, 151.21],
  waw: [52.23, 21.01],
  yul: [45.5, -73.57],
  yyz: [43.65, -79.38],
};

function nearest(lat: number, lon: number): string {
  let best = "iad";
  let least = Infinity;
  for (const [code, [la, lo]] of Object.entries(REGIONS)) {
    // Longitudes wrap, so the date line is no wider than any other.
    const across = ((lo - lon + 540) % 360) - 180;
    const d = (la - lat) ** 2 + (across * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < least) {
      least = d;
      best = code;
    }
  }
  return best;
}

// The region for a request: from where Vercel says it came, or, off
// Vercel, the Fly edge nearest the developer's own machine.
export async function regionFor(request: Request): Promise<string> {
  const lat = request.headers.get("x-vercel-ip-latitude");
  const lon = request.headers.get("x-vercel-ip-longitude");
  if (lat !== null && lon !== null) {
    const [la, lo] = [Number(lat), Number(lon)];
    if (Number.isFinite(la) && Number.isFinite(lo)) return nearest(la, lo);
  }
  try {
    const res = await fetch("https://debug.fly.dev", {
      signal: AbortSignal.timeout(3_000),
    });
    const edge = res.headers.get("fly-region");
    if (edge && edge in REGIONS) return edge;
  } catch {}
  return "iad";
}
