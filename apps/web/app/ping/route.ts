// Nothing but an answer, for a browser timing its trip to Maslow.
export function GET() {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
