// The public origin of a request: the host the browser asked for, over the
// scheme the nearest proxy says it arrived on.
export function origin(request: Request): string {
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}
