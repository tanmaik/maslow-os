// A socket straight to the door on the person's own machine: our server
// names the door and mints the ticket, and the socket goes to the machine
// itself. Resolves once open; fails with our server's word when the
// computer is not ready, or when the door does not answer.
export async function liveSocket(
  path: "talk" | "view",
  query: Record<string, string> = {},
): Promise<WebSocket> {
  const res = await fetch("/computer/live", { cache: "no-store" });
  if (!res.ok) throw new Error((await res.text()) || `Answered ${res.status}.`);
  const { door, ticket } = (await res.json()) as {
    door: string;
    ticket: string;
  };
  const q = new URLSearchParams({ ticket, ...query });
  const ws = new WebSocket(`${door}/maslow/${path}?${q}`);
  ws.binaryType = "arraybuffer";
  return new Promise((open, fail) => {
    ws.onopen = () => open(ws);
    ws.onclose = () => fail(new Error("Could not reach your computer."));
  });
}
