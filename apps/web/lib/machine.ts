// The machine's word for who it is, on a request to one of the app's doors:
// its id and secret as one bearer token, as Claude Code sends a credential,
// or as two headers. Null when the request carries neither.
export function machineFrom(
  request: Request,
): { machineId: string; secret: string } | null {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const dot = bearer?.indexOf(".") ?? -1;
  if (bearer && dot > 0)
    return { machineId: bearer.slice(0, dot), secret: bearer.slice(dot + 1) };
  const secret = request.headers.get("x-computer-secret");
  const machineId = request.headers.get("fly-machine-id");
  return secret && machineId ? { machineId, secret } : null;
}
