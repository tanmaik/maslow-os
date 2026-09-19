// The phone's layout, locked: a fresh stack, a browser the size of a phone,
// and the numbers Tanmai called perfect on 2026-09-18 measured on the
// desktop, so a change to the bar, the dock, a window or the fill fails
// here before it reaches main. No keys, no model.
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
  // Signed in as Wile, the first seeded person, the way the lock screen's
  // development sign-in does it.
  await page.goto("/");
  await page.evaluate(() => {
    const form = document.querySelector('form[action="/auth/dev"]');
    const first = form?.querySelector('input[name="user"]');
    if (first) first.checked = true;
    form?.requestSubmit();
  });
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForSelector(".mac-dock-surface");

  const rect = (sel) =>
    page.evaluate((s) => {
      const all = document.querySelectorAll(s);
      const el = all[all.length - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        width: Math.round(r.width),
        height: Math.round(r.height),
        background: cs.backgroundColor,
        opacity: cs.opacity,
      };
    }, sel);

  // The status bar is the app's own and the menu bar under it one flat
  // band in the app's ground, not glass over the wallpaper.
  const status = await page.evaluate(
    () =>
      document
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute("content") ?? null,
  );
  check("status bar is the app's own", status === "default", `${status}`);
  const bar = await rect(".mac-top-menubar");
  check(
    "menu bar is one band along the top",
    bar && bar.top === 0 && bar.height === BAR && bar.width === WIDTH,
    bar ? `${bar.width}×${bar.height} at ${bar.top}` : "none",
  );
  check(
    "menu bar wears the app's ground",
    bar && bar.background !== "rgba(0, 0, 0, 0)",
    bar?.background ?? "",
  );

  // The dock lies along the bottom, its shelf centred and standing off the
  // edge, and stays while windows stand at their own heights.
  const dock = await rect(".mac-dock-surface");
  check(
    "dock lies along the bottom",
    dock && dock.height === SHELF && dock.bottom === HEIGHT - OFF,
    dock ? `${dock.height} tall, ${HEIGHT - dock.bottom} off the edge` : "none",
  );
  check(
    "dock is centred",
    dock && Math.abs(dock.left - (WIDTH - dock.right)) <= 1,
    dock ? `${dock.left} left, ${WIDTH - dock.right} right` : "none",
  );

  // A window opened from the dock is the full width, eight in from either
  // side, and the dock stays. Against a live stack the click may raise a
  // window already open, which is then put back rather than closed. The
  // page may still be hydrating on a cold stack, so the click is repeated
  // until a window answers it.
  const windows = () =>
    page.evaluate(() => document.querySelectorAll("[data-window]").length);
  const before = await windows();
  // A phone's hand is a tap; a click stands in where a tap is not taken.
  const press = (at) => at.tap().catch(() => at.click());
  const icon = page.locator('.mac-dock-surface button[aria-label="Settings"]');
  for (let i = 0; i < 8 && (await windows()) === before; i++) {
    if (i % 2 === 0) await press(icon);
    else await icon.click();
    await page.waitForTimeout(1000);
  }
  const created = (await windows()) > before;
  await page.waitForSelector("[data-window]");
  // A window arrives out of its icon; measured once it has landed.
  await page.waitForTimeout(600);
  const win = await rect("[data-window]");
  check(
    "window is the full width, 8 in from either side",
    win && win.left === INSET && win.right === WIDTH - INSET,
    win ? `${win.left} to ${win.right}` : "none",
  );
  check(
    "dock stays under a window",
    (await rect(".mac-dock-surface"))?.opacity === "1",
    `opacity ${(await rect(".mac-dock-surface"))?.opacity}`,
  );

  // Filled, the window keeps its insets, the dock goes, and a grip at the
  // bottom edge brings it back.
  await press(
    page.locator('[data-window] button[aria-label="Fill the screen"]').last(),
  );
  await page.waitForTimeout(600);
  const full = await rect("[data-window]");
  check(
    "a filled window keeps its insets",
    full &&
      full.left === INSET &&
      full.right === WIDTH - INSET &&
      full.top === BAR,
    full ? `${full.left} to ${full.right}, top ${full.top}` : "none",
  );
  await page.waitForSelector('button[aria-label="Show the dock"]', {
    timeout: 8000,
  });
  check(
    "dock goes behind a filled window, leaving a grip",
    (await rect(".mac-dock-surface"))?.opacity === "0",
    `opacity ${(await rect(".mac-dock-surface"))?.opacity}`,
  );
  await press(page.locator('button[aria-label="Show the dock"]'));
  await page.waitForTimeout(400);
  check(
    "a tap on the grip brings the dock back",
    (await rect(".mac-dock-surface"))?.opacity === "1",
    `opacity ${(await rect(".mac-dock-surface"))?.opacity}`,
  );
  // The desktop left as it was found: a window this check opened is
  // closed, one it only raised is put back in its place.
  await press(
    page
      .locator(
        created
          ? '[data-window] button[aria-label="Close"]'
          : '[data-window] button[aria-label="Back to its place"]',
      )
      .last(),
  );
  await page.waitForTimeout(400);
} catch (err) {
  check("the phone check ran", false, err.message.slice(0, 120));
  // What the page held when it failed, for the log to say: the dock's
  // icons and the windows, and the page's words only on the check's own
  // seeded stack, never on somebody's live desktop.
  const own = !process.env.PHONE_URL;
  const seen = await browser
    .contexts()[0]
    ?.pages()[0]
    ?.evaluate(
      (words) => ({
        dock: [...document.querySelectorAll(".mac-dock-surface button")].map(
          (b) => b.getAttribute("aria-label"),
        ),
        windows: document.querySelectorAll("[data-window]").length,
        ...(words
          ? { text: document.body.innerText.replace(/\s+/g, " ").slice(0, 400) }
          : {}),
      }),
      own,
    )
    .catch(() => null);
  if (seen) console.log(`      phone: the page held ${JSON.stringify(seen)}`);
} finally {
  await browser.close();
  await stack.stop();
  await fs.rm(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
