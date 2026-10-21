// Where the trial's pretend computer is: here, under /trial. The browser
// opens no socket to it; the page plays the shell itself.
export function GET() {
  return Response.json({ door: "/trial", ticket: "trial" });
}
