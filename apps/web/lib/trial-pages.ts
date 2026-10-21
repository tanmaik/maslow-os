import { BOOKS, DEMO_APPS, RUNS, type DemoApp } from "./trial-computer.ts";

// The pages the trial's apps serve: plain HTML written out here, as the
// apps Claude built would serve them. Read only in a trial.

const esc = (s: string | number) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; padding: 24px; background: Canvas; color: CanvasText; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; opacity: .6; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
  th { font-weight: 600; opacity: .7; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: color-mix(in srgb, CanvasText 8%, transparent); }
  .total { margin-top: 16px; font-size: 13px; opacity: .7; }
</style></head><body>${body}</body></html>`;

function readingList(): string {
  const rows = BOOKS.map(
    (b) =>
      `<tr><td>${esc(b.title)}</td><td>${esc(b.author)}</td><td><span class="pill">${esc(b.status)}</span></td></tr>`,
  ).join("");
  return shell(
    "Reading list",
    `<h1>Reading list</h1><p class="sub">Each book is also a record in your brain.</p>
<table><thead><tr><th>Title</th><th>Author</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

function runLog(): string {
  const rows = RUNS.map(
    (r) =>
      `<tr><td>${esc(r.date)}</td><td>${esc(r.where)}</td><td>${esc(r.km)} km</td><td>${esc(r.minutes)} min</td></tr>`,
  ).join("");
  const km = RUNS.reduce((n, r) => n + r.km, 0);
  return shell(
    "Run log",
    `<h1>Run log</h1><p class="sub">Each run is also a record in your brain.</p>
<table><thead><tr><th>Date</th><th>Where</th><th>Distance</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
<p class="total">${RUNS.length} runs, ${km.toFixed(1)} km in all.</p>`,
  );
}

// The page the app on a port serves, or null for no such app.
export function pageOf(port: string): string | null {
  const app: DemoApp | undefined = DEMO_APPS.find(
    (a) => String(a.port) === port,
  );
  if (!app) return null;
  return app.slug === "reading-list" ? readingList() : runLog();
}
