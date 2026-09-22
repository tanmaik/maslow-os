// The phone's layout, locked: a fresh stack, a browser the size of a phone,
// and the shell measured on it, so a change that lets the tabs leave the
// bottom edge or the page scroll sideways
// fails here before it reaches main. No keys, no model.
//   pnpm check:phone
// Against a stack already up, as beside a running checkout:
//   PHONE_URL=http://localhost:PORT pnpm check:phone
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { freePort, root, startStack } from "./stack.mjs";

// Where the computer image keeps its browsers, where nothing else says;
// said before Playwright loads, since it reads it as it does.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/maslow/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/maslow/browsers";
const { chromium } = createRequire(
  new URL("../packages/browser/package.json", import.meta.url),
)("playwright");

let failed = false;
const check = (label, pass, detail = "") => {
  console.log(
    `${pass ? "ok  " : "FAIL"}  phone: ${label.padEnd(44)} ${detail}`,
  );
  if (!pass) failed = true;
};

// The phone as the guide draws it: 390 by 844, held upright.
const WIDTH = 390;
const HEIGHT = 844;
// The menu bar's height, the window's inset from either side, the dock's
// shelf and how far it stands off the bottom edge.
const BAR = 25;
const INSET = 8;
const SHELF = 73;
const OFF = 18;

await fs.mkdir(path.join(root, ".local"), { recursive: true });
const scratch = await fs.mkdtemp(path.join(root, ".local", "phone-"));
const stack = process.env.PHONE_URL
  ? { url: process.env.PHONE_URL, ready: async () => {}, stop: async () => {} }
  : await startStack({
      webPort: await freePort(),
      stdio: "ignore",
      dataDir: path.join(scratch, "pg"),
      distDir: ".next-phone",
      fresh: true,
      secrets: false,
      env: { UPLOADS_DIR: path.join(scratch, "uploads") },
    });

// The image's own Chromium, else the Chrome a laptop or a GitHub runner
// carries; with neither, this check is skipped and says so.
const launch = async () => {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ channel: "chrome" });
  }
};
let browser;
try {
  browser = await launch();
} catch {
  console.log("skip  phone: no browser on this machine to measure with");
  await stack.stop();
  await fs.rm(scratch, { recursive: true, force: true });
  process.exit(0);
}
try {
  await stack.ready();
  const page = await (
    await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      // At localhost, the one name Next's dev server trusts its own
      // traffic from; at 127.0.0.1 the page never hydrates.
      baseURL: stack.url.replace("127.0.0.1", "localhost"),
    })
  ).newPage();
  // A device that was already asked for the microphone, notifications and
  // the location, so the card that asks once never covers the tabs here.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("maslow.permissions", "asked");
    } catch {
      // A page with no storage is asked, and the check taps Not now.
    }
  });
  // Signed in as Wile, the first seeded person, the way the lock screen's
  // development sign-in does it.
  await page.goto("/");
  await page.evaluate(() => {
    const form = document.querySelector('form[action="/auth/dev"]');
    const first = form?.querySelector('input[name="user"]');
    if (first) first.checked = true;
    form?.requestSubmit();
  });
  await page.waitForURL((u) => u.pathname === "/home");
  await page.waitForSelector('nav[aria-label="Places"]');
  const later = page.getByRole("button", { name: "Not now" });
  if (await later.isVisible({ timeout: 1000 }).catch(() => false))
    await later.tap().catch(() => later.click());

  const rect = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }, sel);

  // The places are tabs along the bottom edge, from side to side.
  const tabs = await rect('nav[aria-label="Places"]');
  check(
    "tabs lie along the bottom, edge to edge",
    tabs && tabs.left === 0 && tabs.right === WIDTH && tabs.bottom === HEIGHT,
    tabs ? `${tabs.left}–${tabs.right}, bottom ${tabs.bottom}` : "none",
  );
  // Every tab is a target a thumb can hit.
  const small = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll(
          'nav[aria-label="Places"] a, nav[aria-label="Places"] button',
        ),
      ]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width < 44 || r.height < 44).length,
  );
  check("every tab is 44 points or more", small === 0, `${small} too small`);

  // A place picked fills the screen.
  await page.locator('nav[aria-label="Places"] a[aria-label="Database"]').tap();
  await page.waitForURL((u) => u.pathname === "/brain");
  const pane = await rect('section[aria-label="Open"]');
  check(
    "a place fills the width of the phone",
    pane && pane.left === 0 && pane.width === WIDTH,
    pane ? `${pane.width} wide` : "none",
  );
  // Nothing but a pane's own content scrolls: the page never goes sideways.
  const across = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  check("the page does not scroll sideways", across <= WIDTH, `${across} wide`);
} finally {
  await browser.close();
  await stack.stop();
  await fs.rm(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
