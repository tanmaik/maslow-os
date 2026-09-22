// Everything the person can be shown has one address, `maslow://`, and
// this is the one place that reads it: what it opens, and the name a pane
// wears for it. An address it cannot read opens nothing.
//
//   maslow://home                     the board of widgets
//   maslow://brain                    the brain
//   maslow://brain/<record id>        one record
//   maslow://fs/notes/plan.md         a file of the person's home, previewed
//   maslow://fs/notes/                a folder of it, in Files
//   maslow://terminal                 the terminal
//   maslow://browser?url=https://…    the computer's browser, at an address
//   maslow://port/3000                an app or a port of their computer
//   maslow://settings/<pane>          a pane of Settings
export type Opened = { href: string; title: string };

const RECORD = /^[0-9a-hjkmnp-tv-z]{10}$/;
const PANE = /^[a-z]{2,20}$/;
const last = (path: string) =>
  path.replace(/\/+$/, "").split("/").at(-1) || "Home";

export function read(
  address: string,
  // The person's own ports by number, as their computer serves them.
  portHref: (port: number) => string | null,
): Opened | null {
  let at: URL;
  try {
    at = new URL(address);
  } catch {
    return null;
  }
  if (at.protocol !== "maslow:") return null;
  const place = at.hostname;
  const rest = decodeURIComponent(at.pathname.replace(/^\//, ""));
  switch (place) {
    case "home":
      return { href: "/home", title: "Home" };
    case "terminal":
      return { href: "/computer/terminal", title: "Terminal" };
    case "brain":
      if (!rest) return { href: "/brain", title: "Database" };
      return RECORD.test(rest)
        ? { href: `/brain/records/${rest}`, title: "Record" }
        : null;
    case "fs": {
      // A path is within the person's home, however it was written.
      const path = rest.replace(/^(home\/me\/?|~\/?)/, "");
      if (path.split("/").includes("..")) return null;
      const folder = rest === "" || at.pathname.endsWith("/");
      return {
        href: folder
          ? `/computer/files?path=${encodeURIComponent(path.replace(/\/+$/, ""))}`
          : `/computer/files/view?path=${encodeURIComponent(path)}`,
        title: last(path),
      };
    }
    case "browser": {
      const url = at.searchParams.get("url");
      if (!url) return { href: "/browser", title: "Browser" };
      return /^https?:\/\//.test(url)
        ? { href: `/browser?url=${encodeURIComponent(url)}`, title: "Browser" }
        : null;
    }
    case "port": {
      const port = Number(rest);
      const href = Number.isInteger(port) ? portHref(port) : null;
      return href ? { href, title: `Port ${port}` } : null;
    }
    case "settings":
      if (!rest) return { href: "/settings", title: "Settings" };
      return PANE.test(rest)
        ? { href: `/settings?pane=${rest}`, title: "Settings" }
        : null;
    default:
      return null;
  }
}
