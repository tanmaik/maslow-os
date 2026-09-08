import { createServer } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import {
  Browser,
  filterSnapshot,
  keyName,
  locate,
  settle,
  snapshot,
} from "./browser.ts";
import { Gif } from "./gif.ts";

// The browser's tools, named and shaped as Claude in Chrome names them, so
// an agent that knows one knows the other. Every answer is a few lines:
// what happened, then the tab's title and address. Written for the
// weakest model that will use them.
type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };

const said = (text: string): Result => ({
  content: [{ type: "text", text }],
});

const tabId = z
  .number()
  .int()
  .optional()
  .describe("which tab; the newest when left out");
const ref = z
  .string()
  .optional()
  .describe("an element from read_page or find, like ref_12");
const coordinate = z
  .array(z.number())
  .length(2)
  .optional()
  .describe("[x, y] pixels from the top left, when there is no ref");

// A path as the caller names it, on the machine's disk: on a computer the
// caller is inside the person's Linux, where home is /home/me, and the
// browser is outside it, where the same home is /data/home.
function place(p: string): string {
  const [from, to] = (process.env.BROWSER_PATHS ?? "").split("=");
  return from && to && (p === from || p.startsWith(`${from}/`))
    ? to + p.slice(from.length)
    : p;
}

function browserServer(browser: Browser, gif: Gif): McpServer {
  const server = new McpServer(
    { name: "browser", version: "1" },
    {
      instructions:
        "A real browser. Start with read_page to see what is on the page as numbered refs, or find to locate something by words; then act on a ref with computer, form_input or navigate. Every answer ends with the tab's title and address. Screenshots are for looking, refs are for acting.",
    },
  );

  // Where the tab is now, after an action.
  const where = async (id: number) => {
    const { page } = await browser.tab(id);
    return `tab ${id}: ${await page.title().catch(() => "")} ${page.url()}`;
  };

  // Every answer is a Result; a failure is one line, never a throw. The
  // browser's one notice, when it has one, rides on the first answer.
  const failing =
    <A>(fn: (args: A) => Promise<string | Result>) =>
    async (args: A): Promise<Result> => {
      try {
        const out = await fn(args);
        const result = typeof out === "string" ? said(out) : out;
        if (browser.notice) {
          result.content.unshift({ type: "text", text: browser.notice });
          browser.notice = null;
        }
        return result;
      } catch (err) {
        const first = (err as Error).message.split("\n")[0]!;
        const result: Result = {
          isError: true,
          ...said(
            /Timeout \d+ms exceeded/.test(first)
              ? "Nothing there within 5 seconds: that ref is not on the page any more. Read the page again."
              : first,
          ),
        };
        if (browser.notice) {
          result.content.unshift({ type: "text", text: browser.notice });
          browser.notice = null;
        }
        return result;
      }
    };

  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    fn: (args: z.infer<z.ZodObject<S>>) => Promise<string | Result>,
  ) => {
    // A batch step is checked against the tool's own shape, as a direct
    // call is by the SDK.
    handlers.set(name, (args) => fn(z.object(shape).parse(args)));
    server.registerTool(
      name,
      { description, inputSchema: shape },
      // The SDK types the callback by its own content unions; ours is a
      // subset of them.
      failing(fn) as unknown as Parameters<typeof server.registerTool>[2],
    );
  };
  const handlers = new Map<
    string,
    (args: unknown) => Promise<string | Result>
  >();

  tool(
    "tabs_context",
    "Lists the open tabs with their ids, titles and addresses. Call this first.",
    {},
    async () => {
      const tabs = await browser.list();
      return tabs.map((t) => `tab ${t.id}: ${t.title} ${t.url}`).join("\n");
    },
  );

  tool(
    "tabs_create",
    "Opens a new empty tab and says its id.",
    {},
    async () => {
      const t = await browser.create();
      return `tab ${t.id}: opened`;
    },
  );

  tool(
    "tabs_close",
    "Closes a tab.",
    { tabId: z.number().int() },
    async ({ tabId: id }) => {
      await browser.close(id);
      return `tab ${id}: closed`;
    },
  );

  tool(
    "navigate",
    "Goes to an address, or 'back' or 'forward' in the tab's history.",
    { url: z.string(), tabId },
    async ({ url, tabId: id }) => {
      const t = await browser.tab(id);
      if (url === "back") await t.page.goBack();
      else if (url === "forward") await t.page.goForward();
      else
        await t.page.goto(/^[a-z]+:/i.test(url) ? url : `https://${url}`, {
          waitUntil: "domcontentloaded",
        });
      await settle(t.page);
      if (gif.recording) await gif.frame(t.page);
      return await where(t.id);
    },
  );

  tool(
    "read_page",
    'The page as numbered refs, one element per line: ref_N: role "name". Use a ref to click, type or fill. filter interactive shows only what can be acted on.',
    {
      tabId,
      filter: z.enum(["interactive", "all"]).optional(),
      depth: z
        .number()
        .int()
        .optional()
        .describe("how deep to read; 15 by default"),
      max_chars: z.number().int().optional().describe("50000 by default"),
    },
    async ({ tabId: id, filter, depth, max_chars }) => {
      const t = await browser.tab(id);
      await settle(t.page);
      const text = filterSnapshot(
        await snapshot(t.page),
        filter ?? "all",
        depth ?? 15,
        max_chars ?? 50_000,
      );
      const size = t.page.viewportSize();
      return `${text}\n\nViewport: ${size?.width ?? "?"}x${size?.height ?? "?"}\n${await where(t.id)}`;
    },
  );

  tool(
    "find",
    "Finds elements by describing them in words, like 'the search box' or 'the Sign in button'. Answers with refs to act on.",
    { query: z.string(), tabId },
    async ({ query, tabId: id }) => {
      const t = await browser.tab(id);
      await settle(t.page);
      const lines = (await snapshot(t.page))
        .split("\n")
        .filter((l) => /ref_\d+:/.test(l));
      const found = findRefs(query, lines);
      if (!found.length)
        return `Nothing on the page matches "${query}". Try read_page.`;
      return `${found.map((l) => l.trim()).join("\n")}\n\n${await where(t.id)}`;
    },
  );

  tool(
    "get_page_text",
    "The page's plain text, for reading an article or a result.",
    { tabId },
    async ({ tabId: id }) => {
      const t = await browser.tab(id);
      await settle(t.page);
      const text = (await t.page.locator("body").innerText()).trim();
      return `${text.length > 50_000 ? `${text.slice(0, 50_000)}\n… cut at 50000 characters` : text}\n\n${await where(t.id)}`;
    },
  );

  tool(
    "computer",
    "Acts on the page: left_click, right_click, double_click, triple_click, hover or scroll_to at a ref or coordinate; type text into what is focused; key presses a chord like Enter, ctrl+a or shift+Tab; scroll with scroll_direction; left_click_drag from start_coordinate; screenshot; zoom into a region; wait some seconds.",
    {
      action: z.enum([
        "left_click",
        "right_click",
        "double_click",
        "triple_click",
        "type",
        "key",
        "scroll",
        "hover",
        "left_click_drag",
        "screenshot",
        "zoom",
        "wait",
        "scroll_to",
      ]),
      tabId,
      ref,
      coordinate,
      text: z
        .string()
        .optional()
        .describe("what to type, or the keys to press"),
      scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
      scroll_amount: z
        .number()
        .int()
        .optional()
        .describe("wheel ticks; 3 by default"),
      start_coordinate: z.array(z.number()).length(2).optional(),
      region: z
        .array(z.number())
        .length(4)
        .optional()
        .describe("[x0, y0, x1, y1] to zoom into"),
      duration: z.number().optional().describe("seconds to wait"),
      modifiers: z
        .string()
        .optional()
        .describe("held while clicking, like shift or ctrl+alt"),
      repeat: z
        .number()
        .int()
        .max(100)
        .optional()
        .describe("how many times to press the keys, at most 100"),
    },
    async (a) => {
      const t = await browser.tab(a.tabId);
      const { page } = t;
      const at = a.ref ? locate(page, a.ref) : null;
      const xy = a.coordinate
        ? { x: a.coordinate[0]!, y: a.coordinate[1]! }
        : null;
      const held = a.modifiers
        ? (keyName(a.modifiers).split("+") as (
            "Control" | "Shift" | "Alt" | "Meta"
          )[])
        : undefined;
      const click = async (
        count: number,
        button: "left" | "right" = "left",
      ) => {
        if (at) {
          await at.scrollIntoViewIfNeeded();
          await at.click({ clickCount: count, button, modifiers: held });
        } else if (xy) {
          // The mouse alone knows no modifiers: they are held on the
          // keyboard around the click, as a hand would.
          for (const m of held ?? []) await page.keyboard.down(m);
          try {
            await page.mouse.click(xy.x, xy.y, { clickCount: count, button });
          } finally {
            for (const m of [...(held ?? [])].reverse())
              await page.keyboard.up(m);
          }
        } else throw new Error("Say a ref or a coordinate to click.");
      };
      switch (a.action) {
        case "left_click":
          await click(1);
          break;
        case "right_click":
          await click(1, "right");
          break;
        case "double_click":
          await click(2);
          break;
        case "triple_click":
          await click(3);
          break;
        case "hover":
          if (at) await at.hover();
          else if (xy) await page.mouse.move(xy.x, xy.y);
          else throw new Error("Say a ref or a coordinate to hover.");
          break;
        case "scroll_to":
          if (!at) throw new Error("Say a ref to scroll to.");
          await at.scrollIntoViewIfNeeded();
          break;
        case "type":
          if (!a.text) throw new Error("Say the text to type.");
          if (at) await at.fill(a.text);
          else await page.keyboard.type(a.text);
          break;
        case "key": {
          if (!a.text) throw new Error("Say the keys to press.");
          for (let i = 0; i < (a.repeat ?? 1); i++)
            for (const chord of a.text.split(/\s+/))
              await page.keyboard.press(keyName(chord));
          break;
        }
        case "scroll": {
          const ticks = (a.scroll_amount ?? 3) * 100;
          if (xy) await page.mouse.move(xy.x, xy.y);
          else if (at) await at.hover();
          const d = a.scroll_direction ?? "down";
          await page.mouse.wheel(
            d === "left" ? -ticks : d === "right" ? ticks : 0,
            d === "up" ? -ticks : d === "down" ? ticks : 0,
          );
          break;
        }
        case "left_click_drag": {
          if (!a.start_coordinate || !xy)
            throw new Error("Say start_coordinate and coordinate.");
          await page.mouse.move(a.start_coordinate[0]!, a.start_coordinate[1]!);
          await page.mouse.down();
          await page.mouse.move(xy.x, xy.y, { steps: 10 });
          await page.mouse.up();
          break;
        }
        case "wait":
          await new Promise((r) =>
            setTimeout(r, Math.min(a.duration ?? 1, 10) * 1000),
          );
          break;
        case "screenshot":
        case "zoom": {
          await settle(page);
          const clip =
            a.action === "zoom" && a.region
              ? {
                  x: a.region[0]!,
                  y: a.region[1]!,
                  width: a.region[2]! - a.region[0]!,
                  height: a.region[3]! - a.region[1]!,
                }
              : undefined;
          const shot = await page.screenshot({
            type: "jpeg",
            quality: 70,
            clip,
          });
          if (gif.recording) await gif.frame(page);
          return {
            content: [
              {
                type: "image",
                data: shot.toString("base64"),
                mimeType: "image/jpeg",
              },
              { type: "text", text: await where(t.id) },
            ],
          };
        }
      }
      await settle(page);
      if (gif.recording) await gif.frame(page);
      return `${a.action} done\n${await where(t.id)}`;
    },
  );

  tool(
    "form_input",
    "Sets a form field by ref: text into a box, a choice in a select, or true/false for a checkbox.",
    { ref: z.string(), value: z.union([z.string(), z.boolean()]), tabId },
    async ({ ref: r, value, tabId: id }) => {
      const t = await browser.tab(id);
      const at = locate(t.page, r);
      await at.scrollIntoViewIfNeeded();
      const kind = await at.evaluate((el) => {
        const e = el as HTMLInputElement;
        return e.tagName === "SELECT"
          ? "select"
          : e.type === "checkbox" || e.type === "radio"
            ? "check"
            : "text";
      });
      if (kind === "check")
        await at.setChecked(value === true || value === "true");
      else if (kind === "select") await at.selectOption(String(value));
      else await at.fill(String(value));
      await settle(t.page);
      if (gif.recording) await gif.frame(t.page);
      return `${r} set\n${await where(t.id)}`;
    },
  );

  tool(
    "file_upload",
    "Puts files into a file picker by ref.",
    { ref: z.string(), paths: z.array(z.string()), tabId },
    async ({ ref: r, paths, tabId: id }) => {
      const t = await browser.tab(id);
      await locate(t.page, r).setInputFiles(paths.map(place));
      if (gif.recording) await gif.frame(t.page);
      return `${paths.length} file${paths.length === 1 ? "" : "s"} chosen\n${await where(t.id)}`;
    },
  );

  tool(
    "javascript_tool",
    "Runs JavaScript on the page and answers with the value of the last expression.",
    { text: z.string(), tabId },
    async ({ text, tabId: id }) => {
      const t = await browser.tab(id);
      // A script that never ends is not waited on forever; after ten
      // seconds the answer says so, and the tab may need a navigate.
      const value = await Promise.race([
        t.page.evaluate(text),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "The script took more than 10 seconds; navigate the tab to get it back.",
                ),
              ),
            10_000,
          ),
        ),
      ]);
      return `${JSON.stringify(value) ?? "undefined"}\n${await where(t.id)}`;
    },
  );

  // A filter from the caller: short, valid, and tried against no more
  // than a few thousand characters of any one line, so a pattern cannot
  // hold the server up.
  const matcher = (pattern: string | undefined) => {
    if (!pattern) return () => true;
    if (pattern.length > 200)
      throw new Error("The pattern is too long; keep it under 200 characters.");
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      throw new Error(`That pattern is not valid: ${(err as Error).message}`);
    }
    return (text: string) => re.test(text.slice(0, 4096));
  };

  tool(
    "read_console_messages",
    "The page's console messages and errors, newest last; pattern filters them.",
    { tabId, pattern: z.string().optional() },
    async ({ tabId: id, pattern }) => {
      const t = await browser.tab(id);
      const keep = matcher(pattern);
      const lines = browser
        .consoleOf(t.page)
        .filter((l) => keep(l.text))
        .map((l) => `${l.at} ${l.level}: ${l.text}`);
      return lines.length ? lines.join("\n") : "No console messages.";
    },
  );

  tool(
    "read_network_requests",
    "The requests the page made, newest last, with their status.",
    { tabId, pattern: z.string().optional() },
    async ({ tabId: id, pattern }) => {
      const t = await browser.tab(id);
      const keep = matcher(pattern);
      const lines = browser
        .requestsOf(t.page)
        .filter((r) => keep(r.url))
        .map((r) => `${r.at} ${r.method} ${r.url} ${r.status ?? "…"}`);
      return lines.length ? lines.join("\n") : "No requests yet.";
    },
  );

  tool(
    "browser_batch",
    "Runs several tool calls in order and answers with each result. Stops at the first that fails.",
    {
      // At most twenty in one go, so one batch cannot hold the browser.
      actions: z
        .array(
          z.object({
            tool: z.string(),
            args: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .max(20),
    },
    async ({ actions }) => {
      // Each step answers like the tool it names, so what was done before
      // a failure is kept and the failure is the last line.
      const out: string[] = [];
      for (const [i, step] of actions.entries()) {
        const fn = handlers.get(step.tool);
        const r =
          !fn || step.tool === "browser_batch"
            ? { isError: true, ...said(`No tool called ${step.tool}.`) }
            : await failing(fn)(step.args ?? {});
        const text = r.content
          .map((c) => (c.type === "text" ? c.text : "(screenshot taken)"))
          .join("\n");
        out.push(`${i + 1}. ${step.tool}: ${text}`);
        if (r.isError) break;
      }
      return out.join("\n");
    },
  );

  tool(
    "gif_creator",
    "Records one tab: start, then every action on it adds a frame, then save writes the GIF to a path.",
    {
      action: z.enum(["start", "frame", "save"]),
      path: z.string().optional(),
      tabId,
    },
    async ({ action, path, tabId: id }) => {
      const t = await browser.tab(id);
      if (action === "start") {
        gif.start(t.page);
        await gif.frame(t.page);
        return `recording tab ${t.id}`;
      }
      if (action === "frame") {
        await gif.frame(t.page);
        return `${gif.frames} frames`;
      }
      if (!path) throw new Error("Say the path to save the GIF to.");
      await gif.frame(t.page);
      const { frames, dropped } = await gif.save(place(path));
      return `${path}: ${frames} frames${dropped ? `; the ${dropped} oldest were let go to keep the recording small` : ""}`;
    },
  );

  tool(
    "resize_window",
    "Sets the tab's size in pixels.",
    { width: z.number().int(), height: z.number().int(), tabId },
    async ({ width, height, tabId: id }) => {
      const t = await browser.tab(id);
      await t.page.setViewportSize({ width, height });
      if (gif.recording) await gif.frame(t.page);
      return `${width}×${height}\n${await where(t.id)}`;
    },
  );

  return server;
}

// The refs whose line carries the words of a description, five at most,
// the ones a person can act on first. Nothing about the page leaves the
// machine: the agent asking is the model, and it reads what it finds.
function findRefs(query: string, lines: string[]): string[] {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return lines
    .map((line) => {
      const low = line.toLowerCase();
      const hits = words.filter((w) => low.includes(w)).length;
      return {
        line,
        hits:
          hits +
          (/^\s*ref_\d+: (button|link|textbox|searchbox|checkbox|combobox)/.test(
            line,
          )
            ? 0.5
            : 0),
      };
    })
    .filter((x) => x.hits >= 1)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5)
    .map((x) => x.line);
}

// Serves the browser: over stdio until the client hangs up, or on the
// machine itself at http://127.0.0.1:<port>/mcp, every request answered
// on its own, where the browser closes after ten idle minutes and opens
// again at the next call, with its profile kept.
export async function serve(http?: number): Promise<void> {
  const browser = new Browser();
  const gif = new Gif();
  const bye = () => browser.quit().finally(() => process.exit(0));
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
  if (http === undefined) {
    await browserServer(browser, gif).connect(new StdioServerTransport());
    process.stdin.on("close", bye);
    return;
  }
  browser.idle(10 * 60_000);
  createServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://browser").pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = browserServer(browser, gif);
    await server.connect(transport);
    res.on("close", () => void server.close());
    await transport.handleRequest(req, res);
  }).listen(http, "127.0.0.1", () =>
    console.log(`the browser is open on ${http}`),
  );
}
