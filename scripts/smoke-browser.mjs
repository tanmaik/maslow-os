// The browser tool, walked as an agent would: the MCP server on stdio,
// five fixture pages served from this process, and four tasks done tool
// call by tool call, then every other tool once. No keys, no model.
//   pnpm check:browser
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

import { root } from "./stack.mjs";

const sdk = createRequire(
  new URL("../packages/browser/package.json", import.meta.url),
);
const { Client } = sdk("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = sdk(
  "@modelcontextprotocol/sdk/client/stdio.js",
);

let failed = false;
const check = (label, pass, detail) => {
  console.log(
    `${pass ? "ok  " : "FAIL"}  browser: ${label.padEnd(40)} ${detail}`,
  );
  if (!pass) failed = true;
};

// The fixture pages, from packages/browser/fixtures.
const fixtures = path.join(root, "packages", "browser", "fixtures");
const site = createServer(async (req, res) => {
  const file = path.join(
    fixtures,
    new URL(req.url, "http://x").pathname.replace(/^\/$/, "/search.html"),
  );
  try {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("not here");
  }
});
// A port the kernel hands out on the spot, so nothing can take it first.
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${site.address().port}`;

const client = new Client({ name: "smoke", version: "1" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "packages", "browser", "bin", "browser-mcp.mjs")],
    env: {
      ...process.env,
      BROWSER_PROFILE: path.join(
        root,
        ".local",
        `browser-smoke-${process.pid}`,
      ),
    },
  }),
);
const tools = (await client.listTools()).tools;
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return {
    text: r.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
    images: r.content.filter((c) => c.type === "image").length,
    error: r.isError === true,
  };
};
const refOf = (text, pattern) =>
  text
    .split("\n")
    .find((l) => pattern.test(l))
    ?.match(/ref_\d+/)?.[0];

check(
  "the tools are the Chrome tool's",
  [
    "tabs_context",
    "tabs_create",
    "tabs_close",
    "navigate",
    "computer",
    "read_page",
    "find",
    "get_page_text",
    "form_input",
    "file_upload",
    "javascript_tool",
    "read_console_messages",
    "read_network_requests",
    "browser_batch",
    "gif_creator",
    "resize_window",
  ].every((n) => tools.some((t) => t.name === n)),
  `${tools.length} tools`,
);

// The four tasks, and what proves each done.
const tasks = [
  {
    name: "search",
    done: (answer, page) =>
      /3/.test(answer) && /Results for bread: 3 recipes/.test(page),
    script: async () => {
      await call("navigate", { url: `${base}/search.html` });
      const page = (await call("read_page", { filter: "interactive" })).text;
      const box = refOf(page, /searchbox|textbox/);
      const button = refOf(page, /button "Search"/);
      await call("form_input", { ref: box, value: "bread" });
      await call("computer", { action: "left_click", ref: button });
      return (await call("get_page_text")).text;
    },
  },
  {
    name: "table",
    done: (answer) => /\b2\b/.test(answer),
    script: async () => {
      await call("navigate", { url: `${base}/table.html` });
      const text = (await call("get_page_text")).text;
      const mars = text.split("\n").find((l) => /^Mars/.test(l)) ?? "";
      return mars.split(/\s+/)[1] ?? "";
    },
  },
  {
    name: "login",
    // The answer alone: a model may wander after it has signed in, and
    // the page it leaves behind is not the greeting.
    done: (answer) => /Welcome, Pat/.test(answer),
    script: async () => {
      await call("navigate", { url: `${base}/login.html` });
      const email = refOf(
        (await call("find", { query: "the email box" })).text,
        /textbox "Email"/,
      );
      const password = refOf(
        (await call("find", { query: "the password box" })).text,
        /textbox "Password"/,
      );
      const button = refOf(
        (await call("find", { query: "the Sign in button" })).text,
        /button "Sign in"/,
      );
      await call("browser_batch", {
        actions: [
          {
            tool: "form_input",
            args: { ref: email, value: "pat@example.test" },
          },
          { tool: "form_input", args: { ref: password, value: "opensesame" } },
          { tool: "computer", args: { action: "left_click", ref: button } },
        ],
      });
      return (await call("get_page_text")).text;
    },
  },
  {
    name: "popover and scroll",
    done: (answer, page) => /7391/.test(answer) && /Claimed/.test(page),
    script: async () => {
      await call("navigate", { url: `${base}/popover.html` });
      const help = refOf(
        (await call("read_page", { filter: "interactive" })).text,
        /button "Help"/,
      );
      await call("computer", { action: "left_click", ref: help });
      const code =
        (await call("get_page_text")).text.match(/code is (\d+)/)?.[1] ?? "";
      const claim = refOf(
        (await call("read_page", { filter: "interactive" })).text,
        /button "Claim"/,
      );
      // The scroll itself is checked: Claim starts below the viewport and
      // is inside it after scrolling to it.
      const top = async () => {
        const r = await call("javascript_tool", {
          text: "[document.getElementById('claim').getBoundingClientRect().top, window.innerHeight]",
        });
        return JSON.parse(r.text.split("\n")[0]);
      };
      const [before, height] = await top();
      await call("computer", { action: "scroll_to", ref: claim });
      const [after] = await top();
      if (!(before > height && after < height))
        throw new Error(`scroll did not move Claim: ${before} then ${after}`);
      await call("computer", { action: "left_click", ref: claim });
      return `${code} ${(await call("get_page_text")).text}`;
    },
  },
];

// Scripted: the tools, one by one.
for (const t of tasks) {
  try {
    const answer = await t.script();
    const page = (await call("get_page_text")).text;
    check(
      `scripted: ${t.name}`,
      t.done(answer, page),
      answer.split("\n")[0].slice(0, 60),
    );
  } catch (err) {
    check(`scripted: ${t.name}`, false, err.message.slice(0, 80));
  }
}

// The rest of the tools, once each.
{
  await call("navigate", { url: `${base}/table.html` });
  const shot = await call("computer", { action: "screenshot" });
  check(
    "screenshot is an image",
    shot.images === 1 && !shot.error,
    `${shot.images} image`,
  );
  const zoom = await call("computer", {
    action: "zoom",
    region: [0, 0, 300, 200],
  });
  check("zoom is an image", zoom.images === 1, `${zoom.images} image`);
  const js = await call("javascript_tool", {
    text: "document.querySelectorAll('tr').length",
  });
  check("javascript answers", /^6\b/.test(js.text), js.text.split("\n")[0]);
  await call("javascript_tool", {
    text: "console.log('hello from the page'); 1",
  });
  const logs = await call("read_console_messages", { pattern: "hello" });
  check(
    "console is read",
    /hello from the page/.test(logs.text),
    logs.text.split("\n")[0].slice(0, 50),
  );
  const net = await call("read_network_requests", { pattern: "table" });
  check(
    "requests are read",
    /GET .*table\.html 200/.test(net.text),
    net.text.split("\n")[0].slice(0, 60),
  );
  const tab = await call("tabs_create");
  const id = Number(tab.text.match(/tab (\d+)/)?.[1]);
  const listed = await call("tabs_context");
  await call("tabs_close", { tabId: id });
  const after = await call("tabs_context");
  check(
    "tabs open, list and close",
    listed.text.includes(`tab ${id}:`) && !after.text.includes(`tab ${id}:`),
    `tab ${id}`,
  );
  const size = await call("resize_window", { width: 800, height: 600 });
  check("window resizes", /800×600/.test(size.text), size.text.split("\n")[0]);
  const gifPath = path.join(root, ".local", `browser-smoke-${process.pid}.gif`);
  await call("gif_creator", { action: "start" });
  await call("computer", { action: "scroll", scroll_direction: "down" });
  const saved = await call("gif_creator", { action: "save", path: gifPath });
  check("gif is written", /frames/.test(saved.text), saved.text);
  await call("navigate", { url: `${base}/upload.html` });
  // Chromium shows a file picker as a button named by its label.
  const picker = refOf(
    (await call("read_page", { filter: "all" })).text,
    /button "Your file"/,
  );
  const sent = await call("file_upload", {
    ref: picker,
    paths: [path.join(fixtures, "table.html")],
  });
  const chosen = (await call("get_page_text")).text;
  check(
    "a file is uploaded",
    !sent.error && /Chosen: table\.html, \d+ bytes/.test(chosen),
    chosen.split("\n").find((l) => /Chosen|No file/.test(l)) ?? sent.text,
  );
  const partial = await call("browser_batch", {
    actions: [
      { tool: "tabs_context" },
      { tool: "computer", args: { action: "left_click", ref: "ref_99999" } },
      { tool: "tabs_context" },
    ],
  });
  check(
    "a batch keeps what it did before a failure",
    /^1\. tabs_context: tab/.test(partial.text) &&
      /^2\. computer: /m.test(partial.text) &&
      !/^3\./m.test(partial.text),
    `${partial.text.split("\n").length} lines`,
  );
  const bad = await call("computer", {
    action: "left_click",
    ref: "ref_99999",
  });
  check(
    "a wrong ref fails in one line",
    bad.error && !bad.text.includes("\n"),
    bad.text.slice(0, 60),
  );
}

await client.close();
site.close();
process.exit(failed ? 1 : 0);
