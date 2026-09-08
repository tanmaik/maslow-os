import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";

// One Chromium with a profile that lasts, so logins stick, and the tabs
// in it numbered for the agent. Every page's console and requests are
// kept as they happen, so they can be read after.
export type Tab = { id: number; page: Page };
export type ConsoleLine = { at: string; level: string; text: string };
export type Request = {
  at: string;
  method: string;
  url: string;
  status: number | null;
};

const KEPT = 200;

export class Browser {
  private context: BrowserContext | null = null;
  private tabs = new Map<number, Page>();
  private nextTab = 1;
  private consoles = new WeakMap<Page, ConsoleLine[]>();
  private requests = new WeakMap<Page, Request[]>();
  // One line the first answer carries, when the profile could not be used.
  notice: string | null = null;
  // The fresh profile made in that case, gone when the browser quits.
  private fresh: string | null = null;

  // Opens the profile, headless unless BROWSER_HEADED is set. A profile
  // another browser holds open cannot be shared, so a second process gets
  // a fresh one for its own life and says so. Tabs the profile reopened
  // on its own are numbered too.
  async open(): Promise<BrowserContext> {
    if (this.context) return this.context;
    // Two callers at once open one browser: the second waits on the first.
    this.opening ??= this.launch().finally(() => (this.opening = null));
    return this.opening;
  }

  private opening: Promise<BrowserContext> | null = null;

  private async launch(): Promise<BrowserContext> {
    const dir =
      process.env.BROWSER_PROFILE ??
      path.join(homedir(), ".config", "maslow-browser");
    await mkdir(dir, { recursive: true });
    const options = {
      headless: !process.env.BROWSER_HEADED,
      viewport: { width: 1280, height: 800 },
    };
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(dir, options);
    } catch (err) {
      const fresh = await mkdtemp(path.join(tmpdir(), "maslow-browser-"));
      this.fresh = fresh;
      context = await chromium.launchPersistentContext(fresh, options);
      this.notice = `The profile at ${dir} is held by another browser (${(err as Error).message.split("\n")[0]}); this one has a fresh profile, and logins made here do not last.`;
    }
    // A ref that is not on the page fails in seconds, not half a minute.
    context.setDefaultTimeout(5_000);
    for (const p of context.pages()) this.track(p);
    context.on("page", (p) => this.track(p));
    if (this.tabs.size === 0) await context.newPage();
    // Published only once it is whole, so nobody sees a browser without
    // its first tab.
    this.context = context;
    return context;
  }

  private track(page: Page) {
    if ([...this.tabs.values()].includes(page)) return;
    const id = this.nextTab++;
    this.tabs.set(id, page);
    const lines: ConsoleLine[] = [];
    const reqs: Request[] = [];
    this.consoles.set(page, lines);
    this.requests.set(page, reqs);
    const keep = <T>(list: T[], item: T) => {
      list.push(item);
      if (list.length > KEPT) list.shift();
    };
    page.on("console", (m) =>
      keep(lines, {
        at: new Date().toISOString(),
        level: m.type(),
        text: m.text(),
      }),
    );
    page.on("pageerror", (e) =>
      keep(lines, {
        at: new Date().toISOString(),
        level: "error",
        text: e.message,
      }),
    );
    page.on("request", (r) => {
      const entry: Request = {
        at: new Date().toISOString(),
        method: r.method(),
        url: r.url(),
        status: null,
      };
      keep(reqs, entry);
      r.response()
        .then((res) => {
          entry.status = res?.status() ?? null;
        })
        .catch(() => {});
    });
    page.on("close", () => this.tabs.delete(id));
  }

  async list(): Promise<{ id: number; title: string; url: string }[]> {
    await this.open();
    const out = [];
    for (const [id, page] of this.tabs)
      out.push({
        id,
        title: await page.title().catch(() => ""),
        url: page.url(),
      });
    return out;
  }

  // The tab asked for, or the newest when none is named.
  async tab(id?: number): Promise<Tab> {
    await this.open();
    if (id === undefined) {
      const last = [...this.tabs.entries()].at(-1);
      if (!last) throw new Error("There is no tab open; create one.");
      return { id: last[0], page: last[1] };
    }
    const page = this.tabs.get(id);
    if (!page) throw new Error(`There is no tab ${id}.`);
    return { id, page };
  }

  async create(): Promise<Tab> {
    const context = await this.open();
    const page = await context.newPage();
    this.track(page);
    return this.tab([...this.tabs.entries()].find(([, p]) => p === page)![0]);
  }

  async close(id: number): Promise<void> {
    const { page } = await this.tab(id);
    await page.close();
    this.tabs.delete(id);
  }

  consoleOf(page: Page): ConsoleLine[] {
    return this.consoles.get(page) ?? [];
  }

  requestsOf(page: Page): Request[] {
    return this.requests.get(page) ?? [];
  }

  async quit(): Promise<void> {
    await this.context?.close();
    this.context = null;
    if (this.fresh) await rm(this.fresh, { recursive: true, force: true });
    this.fresh = null;
  }
}

// Waits for the page to settle after an action: the document loaded, the
// network quiet for a moment or two seconds, whichever comes first, and
// then the page's own scripts given two frames to draw what the action
// changed, so a read right after a click sees the popover the click made.
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await Promise.race([
    page.waitForLoadState("networkidle").catch(() => {}),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  // A page that never draws is not waited on: one second at most.
  await Promise.race([
    page
      .evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      )
      .catch(() => {}),
    new Promise((r) => setTimeout(r, 1000)),
  ]);
  await new Promise((r) => setTimeout(r, 100));
}

// The page as the agent reads it: Playwright's accessibility snapshot in
// its "ai" mode (public since 1.63), whose `[ref=…]` marks resolve back
// through the `aria-ref=…` selector. Playwright's marks are tokens like
// e6 or f1e6; each is numbered in reading order and shown as a leading
// `ref_N:`, so a line reads `ref_4: button "Search"`, and the numbering
// is kept per tab until the next read.
const marks = new WeakMap<Page, Map<number, string>>();

export async function snapshot(page: Page): Promise<string> {
  const text = await page.locator("html").ariaSnapshot({ mode: "ai" });
  const table = new Map<number, string>();
  marks.set(page, table);
  return text
    .split("\n")
    .map((line) => {
      const m = /^(\s*)- (.*?)\s*\[ref=([a-z0-9]+)\](.*)$/.exec(line);
      if (!m) return line.replace(/^(\s*)- /, "$1");
      const n = table.size + 1;
      table.set(n, m[3]!);
      return `${m[1]}ref_${n}: ${m[2]}${m[4]}`;
    })
    .join("\n");
}

// A ref from the last read of the tab, back to the element it named.
export function locate(page: Page, ref: string): Locator {
  const m = /^(?:ref_)?(\d+)$/.exec(ref.trim());
  const mark = m ? marks.get(page)?.get(Number(m[1])) : undefined;
  if (!mark)
    throw new Error(
      `"${ref}" is not a ref from this tab's last read; read the page or find first.`,
    );
  return page.locator(`aria-ref=${mark}`);
}

// Roles a person can act on; the rest is reading.
const INTERACTIVE =
  /^(\s*)ref_\d+: (button|link|textbox|searchbox|checkbox|radio|combobox|listbox|option|menuitem|menuitemcheckbox|menuitemradio|tab|slider|spinbutton|switch)\b/;

export function filterSnapshot(
  text: string,
  filter: "interactive" | "all",
  depth: number,
  maxChars: number,
): string {
  let lines = text.split("\n");
  lines = lines.filter((l) => (l.match(/^ */)?.[0].length ?? 0) / 2 <= depth);
  if (filter === "interactive")
    lines = lines.filter(
      (l) => INTERACTIVE.test(l) || /\[cursor=pointer\]/.test(l),
    );
  let out = lines.join("\n");
  if (out.length > maxChars)
    out = `${out.slice(0, maxChars)}\n… cut at ${maxChars} characters of ${out.length}; ask with a larger max_chars, a smaller depth, or filter interactive.`;
  return out;
}

// A Chrome-style key chord as Playwright spells it: ctrl+shift+` becomes
// Control+Shift+`.
export function keyName(chord: string): string {
  const names: Record<string, string> = {
    ctrl: "Control",
    control: "Control",
    shift: "Shift",
    alt: "Alt",
    option: "Alt",
    cmd: "Meta",
    meta: "Meta",
    win: "Meta",
    windows: "Meta",
    esc: "Escape",
    return: "Enter",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    space: " ",
    pageup: "PageUp",
    pagedown: "PageDown",
    capslock: "CapsLock",
    numlock: "NumLock",
    scrolllock: "ScrollLock",
    printscreen: "PrintScreen",
    plus: "+",
  };
  // A chord ending in "++" means the plus key itself.
  return chord
    .replace(/\+\+$/, "+plus")
    .split("+")
    .map(
      (k) =>
        names[k.toLowerCase()] ??
        (k.length === 1 ? k : k[0]!.toUpperCase() + k.slice(1)),
    )
    .join("+");
}
