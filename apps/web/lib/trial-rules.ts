// What a trial says about itself, in the words every refusal and every
// notice uses, and where to get the real thing. Nothing here reads the
// database, so the proxy and the browser may import it.
export const REPO = "https://github.com/tanmaik/maslow-os";
export const TRIAL_HOURS = 24;
export const NO_FILES =
  "The trial keeps no files. Run your own Maslow OS to upload.";

// The addresses a trial does not have, answered 404 before any route runs:
// the brain's MCP and its OAuth, which would hand a stranger's agent a
// door in; inviting and the members, groups and keys that come with
// others; another org, or leaving this one; and everything that makes,
// reaches or shares a computer, of which a trial has none.
const SHUT = [
  /^\/mcp(\/|$)/,
  /^\/oauth(\/|$)/,
  /^\/\.well-known\/oauth-/,
  /^\/invite(\/|$)/,
  /^\/ssh(\/|$)/,
  /^\/settings\/(members|groups|keys|org)(\/|$)/,
  /^\/auth\/(new-org|switch|leave|delete-org|email|code|device|dev)(\/|$)/,
  /^\/computer\/(publish|share|move|reset|update|backups|open|location)(\/|$)/,
  /^\/file\//,
  /^\/port\//,
];

export const shutInTrial = (pathname: string) =>
  SHUT.some((re) => re.test(pathname));

// What a trial answers in place of the computer it does not have: the
// pretend one's home folder and shell, under /trial, read-only.
export const READ_ONLY = "Read-only in the trial";
const READS = /^\/computer\/files\/(list|read|shared|share)$/;
const WRITES =
  /^\/computer\/files\/(write|upload|mkdir|rename|delete|share|preview|pdf)$/;

export function inTrial(
  pathname: string,
  method: string,
): { to: string } | { refuse: string; status: number } | null {
  if (pathname === "/computer/live") return { to: "/trial/live" };
  const read = READS.exec(pathname);
  if (read && (method === "GET" || method === "HEAD"))
    return { to: `/trial/files/${read[1]}` };
  const wrote = WRITES.exec(pathname);
  if (wrote)
    return wrote[1] === "preview" || wrote[1] === "pdf"
      ? { refuse: "No preview in the trial.", status: 404 }
      : { refuse: READ_ONLY, status: 403 };
  return null;
}

// Whether an address is the trial's own, which nothing else may reach.
export const trialOnly = (pathname: string) => /^\/trial(\/|$)/.test(pathname);
