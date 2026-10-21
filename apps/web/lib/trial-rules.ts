// What a trial says about itself, in the words every refusal and every
// notice uses, and where to get the real thing. Nothing here reads the
// database, so the proxy and the browser may import it.
export const REPO = "https://github.com/maslow-tech/maslow-os";
export const TRIAL_HOURS = 24;
export const NO_FILES =
  "The trial keeps no files. Run your own Maslow OS to upload.";
export const NO_COMPUTER =
  "The trial has no computer. On your own Maslow, this is where you and Claude build apps that bring your data in.";

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
  /^\/computer\/(publish|share|move|reset|update|backups|files|open|live|location)(\/|$)/,
  /^\/file\//,
  /^\/port\//,
];

export const shutInTrial = (pathname: string) =>
  SHUT.some((re) => re.test(pathname));
