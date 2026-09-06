// The agent on this machine: one harness process per conversation, spoken to
// over ACP, with every update fanned out to the browser's socket and to the
// app. The app says how a session is configured; the volume remembers what
// was running, so a boot brings back what a restart cut off.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import * as acp from "@agentclientprotocol/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER = path.join(
  here,
  "node_modules",
  "@agentclientprotocol",
  "claude-agent-acp",
  "dist",
  "index.js",
);
const FAKE = path.join(here, "fake-agent.mjs");
// The harness as the chroot sees it: the daemon's directory, bound inside
// at /opt/maslow, where a vendor's software lives on a Debian.
const ADAPTER_IN_OS =
  "/opt/maslow/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js";
const FAKE_IN_OS = "/opt/maslow/fake-agent.mjs";
const IDLE = 30 * 60_000;
// A wakeup the harness scheduled keeps it alive this long past its time, so
// the turn it starts is not cut off.
const WAKE_GRACE = 5 * 60_000;
// The client capabilities the adapter reads for what it streams: background
// tasks (a workflow, a backgrounded command) as they spawn and settle.
const CLIENT_CAPABILITIES = {
  _meta: { jetbrains: { air: { version: 1, capabilities: ["asyncTasks"] } } },
};
// Subagents' words are streamed too, stamped with the call that spawned them.
const SESSION_META = { claudeCode: { options: { forwardSubagentText: true } } };
const RESTARTED =
  "The machine restarted underneath you mid-turn. Continue from where the transcript ends.";

export function agents({
  root,
  osRoot,
  person,
  machineId,
  secret,
  agentUrl,
  log,
}) {
  const file = path.join(root, ".placeholder", "sessions.json");
  const live = new Map();
  let records = {};

  // Read once: what the daemon holds after that is the truth, and a later
  // restore works from it.
  let loading;
  const loadRecords = () =>
    (loading ??= fs
      .readFile(file, "utf8")
      .then((text) => (records = JSON.parse(text)))
      .catch(() => (records = {})));
  // Writes land one after another, so two never tear the file.
  let saving = Promise.resolve();
  // Written whole into a file that is moved into place, so a boot never
  // reads half of one.
  function saveRecords() {
    const next = saving.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(records));
      await fs.rename(tmp, file);
    });
    saving = next.catch(() => {});
    return next;
  }
  // No socket is answered before the records are read and every session
  // cut mid-turn has begun its restart, so a session begun meanwhile is
  // never overwritten by the read, and a restart is told before the person
  // speaks. A socket then waits on its own session's start alone.
  let loaded;
  const restored = new Promise((r) => (loaded = r));

  // Asks the app, as this machine, about a session.
  async function call(step, body) {
    const res = await fetch(`${agentUrl}/${step}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "fly-machine-id": machineId,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const err = new Error(`the app answered ${res.status} to ${step}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  function spawnHarness(fake, model) {
    // One model for everything the harness does, its side calls included:
    // the gateway pays for nothing else.
    const env = {
      IS_SANDBOX: "1",
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_FABLE_MODEL: model,
      CLAUDE_CODE_SUBAGENT_MODEL: model,
      LANG: "C.UTF-8",
    };
    // Inside the operating system on the volume, at home, as the person:
    // what the agent makes is theirs, where their shell finds it.
    if (osRoot)
      return spawn(
        "/usr/sbin/chroot",
        [
          `--userspec=${person.uid}:${person.gid}`,
          osRoot,
          "/usr/bin/env",
          "-C",
          person.home,
          `HOME=${person.home}`,
          `USER=${person.name}`,
          `LOGNAME=${person.name}`,
          "PATH=/usr/local/bin:/usr/bin:/bin",
          ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
          "node",
          fake ? FAKE_IN_OS : ADAPTER_IN_OS,
        ],
        { stdio: ["pipe", "pipe", "pipe"], cwd: "/" },
      );
    // On a laptop the disk stands in for the volume as far as it can: it is
    // the harness's home and working directory, its config and transcripts
    // live on it, and nothing of the laptop's own environment reaches it
    // beyond the tools on PATH. There is no chroot on a laptop; the field
    // guide's isolation is exercised on the preview.
    return spawn(process.execPath, [fake ? FAKE : ADAPTER], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: root,
        CLAUDE_CONFIG_DIR: path.join(root, ".claude"),
        TMPDIR: path.join(root, ".tmp"),
        USER: "root",
        ...env,
      },
    });
  }

  // One conversation's harness, started for a session id: asks the app how,
  // spawns the harness, loads the transcript if there is one, and is ready.
  async function start(id) {
    const boot = await call("bootstrap", { session: id });
    const record = (records[id] ??= {
      acpSessionId: null,
      model: boot.model,
      turn: false,
      seq: 0,
      since: null,
    });
    // Wakeups the harness asked for and crons it set: what keeps it alive
    // with nobody watching, and what a boot brings back.
    record.wakeups ??= [];
    record.crons ??= [];
    // Events are numbered on from the last the app holds: a disk put back
    // from a backup, or made afresh, must not number over what is recorded.
    record.seq = Math.max(record.seq, boot.seq ?? 0);
    // The model is the app's word: what the person picked, or what the
    // deployment offers instead when that is gone.
    record.model = boot.model;
    const s = {
      id,
      fake: boot.fake,
      model: record.model,
      proc: null,
      agent: null,
      acpId: null,
      ws: null,
      partial: "",
      thought: "",
      tools: new Map(),
      tasks: new Map(),
      turn: null,
      replaying: false,
      queue: [],
      posting: null,
      idle: null,
      stopping: false,
      recent: [],
    };
    if (!osRoot) await fs.mkdir(path.join(root, ".tmp"), { recursive: true });
    const proc = spawnHarness(boot.fake, boot.model);
    s.proc = proc;
    proc.stderr.on("data", (d) =>
      log(`agent ${id.slice(0, 8)}: ${String(d).trimEnd()}`),
    );
    proc.on("exit", (code) => {
      if (s.stopping) return;
      log(`agent ${id.slice(0, 8)} exited ${code}`);
      if (s.turn) finish(s, "error", null, "The agent process exited.");
      s.ws?.send(
        JSON.stringify({
          error: "The agent stopped. Reload to start it again.",
        }),
      );
      if (s.idle) clearTimeout(s.idle);
      s.idle = null;
      if (live.get(id) === s) live.delete(id);
    });
    // A harness that does not come up is not left running.
    try {
      await bringUp(s, proc, record, boot);
    } catch (err) {
      s.stopping = true;
      proc.kill();
      throw err;
    }
    // Live only once it can be spoken to; a second socket meanwhile waits on
    // the same start.
    live.set(id, s);
    armWakeups(id);
    return s;
  }

  // The harness spoken to for the first time: told the gateway, given its
  // transcript back or a fresh session, and let off asking permission.
  async function bringUp(s, proc, record, boot) {
    const id = s.id;
    const stream = acp.ndJsonStream(
      Writable.toWeb(proc.stdin),
      Readable.toWeb(proc.stdout),
    );
    const conn = acp
      .client({ name: "placeholder" })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
        // Full freedom: whatever still asks is allowed.
        const allow =
          ctx.params.options.find((o) => o.kind === "allow_always") ??
          ctx.params.options.find((o) => o.kind === "allow_once") ??
          ctx.params.options[0];
        return {
          outcome: allow
            ? { outcome: "selected", optionId: allow.optionId }
            : { outcome: "cancelled" },
        };
      })
      .onNotification(acp.methods.client.session.update, (ctx) =>
        onUpdate(s, ctx.params.update),
      )
      .connect(stream);
    s.agent = conn.agent;
    const init = await s.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
    });
    if (!boot.fake)
      await s.agent.request(acp.methods.agent.providers.set, {
        providerId: "main",
        apiType: "anthropic",
        baseUrl: boot.gateway,
        headers: {
          "x-computer-secret": secret,
          "fly-machine-id": machineId,
          "x-agent-session": id,
        },
      });
    const cwd = osRoot ? person.home : root;
    const mcpServers = boot.mcpServers ?? [];
    if (record.acpSessionId && init.agentCapabilities?.loadSession) {
      s.replaying = true;
      try {
        await s.agent.request(acp.methods.agent.session.load, {
          sessionId: record.acpSessionId,
          cwd,
          mcpServers,
          _meta: SESSION_META,
        });
        s.acpId = record.acpSessionId;
      } catch (err) {
        log(
          `agent ${id.slice(0, 8)}: transcript not loaded (${err.message}); starting afresh`,
        );
      } finally {
        s.replaying = false;
      }
    }
    if (!s.acpId) {
      const made = await s.agent.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers,
        _meta: SESSION_META,
      });
      s.acpId = made.sessionId;
      record.acpSessionId = made.sessionId;
      await saveRecords();
    }
    if (!boot.fake)
      await s.agent
        .request(acp.methods.agent.session.setMode, {
          sessionId: s.acpId,
          modeId: "bypassPermissions",
        })
        .catch((err) =>
          log(`agent ${id.slice(0, 8)}: bypass not set (${err.message})`),
        );
  }

  // The wakeups a harness before this one asked for: its own timers died
  // with it, so the daemon fires them. Each stays on the record until its
  // turn begins, and waits out a turn in progress.
  function armWakeups(id) {
    const record = records[id];
    for (const w of record?.wakeups ?? []) {
      const fire = () => {
        const now = live.get(id);
        if (!records[id] || !now) return;
        if (now.turn) return setTimeout(fire, 1000).unref();
        const i = record.wakeups.indexOf(w);
        if (i < 0) return;
        record.wakeups.splice(i, 1);
        saveRecords().catch(() => {});
        prompt(now, w.prompt || "Continue.", w).catch(() => {});
      };
      setTimeout(fire, Math.max(0, w.at - Date.now())).unref();
    }
  }

  function onUpdate(s, u) {
    if (process.env.AGENT_TRACE)
      log(`trace ${s.id.slice(0, 8)} ${JSON.stringify(u).slice(0, 600)}`);
    if (s.replaying || !records[s.id]) return;
    const meta = u._meta?.claudeCode ?? {};
    const text = (c) => (c?.type === "text" ? c.text : "");
    // Words or a tool call with no turn open: the harness began one on its
    // own, from a wakeup it scheduled or a task that came back.
    if (
      !s.turn &&
      ["agent_message_chunk", "agent_thought_chunk", "tool_call"].includes(
        u.sessionUpdate,
      )
    )
      wake(s);
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        const t = text(u.content);
        if (!t) return;
        // A subagent's words are its own activity, not the conversation's.
        if (meta.parentToolUseId) return activity(s, meta.parentToolUseId, t);
        flushThought(s);
        s.partial += t;
        send(s, { stream: t });
        return;
      }
      case "agent_thought_chunk":
        if (meta.parentToolUseId) return;
        s.thought += text(u.content);
        return;
      case "tool_call": {
        flushThought(s);
        flushText(s);
        const tool = pick(u);
        s.tools.set(u.toolCallId, tool);
        send(s, { tool });
        return;
      }
      case "tool_call_update": {
        const tool = {
          ...(s.tools.get(u.toolCallId) ?? {
            toolCallId: u.toolCallId,
            title: "Tool",
          }),
          ...pick(u),
        };
        s.tools.set(u.toolCallId, tool);
        send(s, { tool });
        if (tool.status === "completed" || tool.status === "failed") {
          s.tools.delete(u.toolCallId);
          emit(s, "tool", tool);
          if (tool.status === "completed") scheduled(s, tool, u.rawOutput);
        }
        return;
      }
      case "usage_update":
        // The cost of a cycle arrives once, as it ends. For a turn the
        // harness began itself, that is the only word that it is over.
        if (u.cost && s.turn?.self) finish(s, "end_turn", null, null);
        return;
      case "async_task_spawned":
      case "async_task_progress":
      case "async_task_state_update":
        task(s, u);
        return;
      case "session_info_update":
        if (typeof u.title === "string" && u.title.trim())
          emit(s, "title", { title: u.title.trim() });
        return;
      default:
        return;
    }
  }

  // The harness woke on its own. The wakeup it scheduled that is due, if
  // one is, says why; a turn opens either way, recorded like any other.
  function wake(s) {
    const record = records[s.id];
    const now = Date.now();
    const i = record.wakeups.findIndex((w) => w.at <= now + 60_000);
    const w = i >= 0 ? record.wakeups.splice(i, 1)[0] : null;
    const started = emit(
      s,
      "wake",
      w ? { prompt: w.prompt, reason: w.reason } : {},
    );
    // The turn began when the wakeup fired, not when its first word arrived.
    const since = w ? new Date(Math.min(now, w.at)).toISOString() : started.at;
    s.turn = { since, self: true };
    record.turn = true;
    record.since = started.at;
    saveRecords().catch(() => {});
    if (s.idle) clearTimeout(s.idle);
    s.idle = null;
  }

  // What the harness asked to be woken for, read off the calls that asked:
  // a one-off wakeup with its time and prompt, a cron for as long as it
  // stands. Both keep the harness alive; a wakeup survives a restart because
  // the daemon fires it itself when the harness that set it is gone.
  function scheduled(s, tool, output) {
    const record = records[s.id];
    const input = tool.rawInput ?? {};
    const name = tool.toolName ?? tool.title;
    if (name === "ScheduleWakeup") {
      if (input.stop) record.wakeups = [];
      else if (typeof input.delaySeconds === "number")
        record.wakeups.push({
          at:
            Date.now() +
            Math.min(Math.max(input.delaySeconds, 60), 3600) * 1000,
          prompt: typeof input.prompt === "string" ? input.prompt : "",
          reason: typeof input.reason === "string" ? input.reason : "",
        });
    } else if (name === "CronCreate") {
      record.crons.push({
        id: idOf(output) ?? tool.toolCallId,
        cron: typeof input.cron === "string" ? input.cron : "",
        prompt: typeof input.prompt === "string" ? input.prompt : "",
      });
    } else if (name === "CronDelete") {
      const i = record.crons.findIndex((c) => c.id === input.id);
      if (i >= 0) record.crons.splice(i, 1);
      else record.crons.pop();
    } else return;
    saveRecords().catch(() => {});
    armIdle(s);
  }

  // The id a tool answered with, when it named one.
  function idOf(output) {
    const text =
      typeof output === "string"
        ? output
        : Array.isArray(output)
          ? output.map((c) => c?.text ?? "").join("\n")
          : "";
    return text.match(/\bid[:=]?\s*["`']?([A-Za-z0-9_-]{4,})/)?.[1] ?? null;
  }

  // A subagent's latest words, kept on the call that spawned it.
  function activity(s, parent, t) {
    const tool = s.tools.get(parent);
    if (!tool) return;
    tool.activity = `${tool.activity ?? ""}${t}`.slice(-240);
    send(s, { tool });
  }

  // A background task, a workflow or a backgrounded command, as the harness
  // reports it: announced, progressing, settled. Each change is an event
  // with the task's id, so the page keeps the latest word on each.
  function task(s, u) {
    const t = {
      ...(s.tasks.get(u.asyncTaskId) ?? {
        id: u.asyncTaskId,
        state: "running",
      }),
    };
    for (const k of ["name", "taskType", "description", "state", "summary"])
      if (u[k] !== undefined && u[k] !== null) t[k] = u[k];
    if (u.toolCallId) t.toolCallId = u.toolCallId;
    s.tasks.set(t.id, t);
    send(s, { task: t });
    if (u.sessionUpdate !== "async_task_progress") emit(s, "task", t);
  }

  // A tool call's shape as the page shows it, with nulls left out.
  function pick(u) {
    const t = { toolCallId: u.toolCallId };
    for (const k of [
      "title",
      "kind",
      "status",
      "locations",
      "content",
      "rawInput",
    ])
      if (u[k] !== undefined && u[k] !== null) t[k] = u[k];
    // What the harness says about the call beyond the protocol: the tool's
    // own name, the call that spawned it, a subagent's kind and its bill.
    const m = u._meta?.claudeCode;
    if (m?.toolName) t.toolName = m.toolName;
    if (m?.parentToolUseId) t.parent = m.parentToolUseId;
    if (m?.subagent || m?.toolName === "Agent") t.agent = true;
    if (m?.toolResponse?.subagentType)
      t.agentType = m.toolResponse.subagentType;
    if (m?.toolResponse?.workflowName)
      t.workflow = {
        name: m.toolResponse.workflowName,
        runId: m.toolResponse.runId ?? null,
        taskId: m.toolResponse.taskId ?? null,
      };
    const usage = trailer(u.rawOutput);
    if (usage) t.usage = usage;
    return t;
  }

  // What a finished subagent cost, from the trailer on its report:
  // tokens, tool uses, how long, and the id it can be reached by.
  function trailer(output) {
    if (!Array.isArray(output)) return null;
    const text = output.map((c) => c?.text ?? "").join("\n");
    const n = (k) => {
      const m = text.match(new RegExp(`${k}:\\s*(\\d+)`));
      return m ? Number(m[1]) : null;
    };
    const tokens = n("subagent_tokens");
    if (tokens === null) return null;
    return {
      tokens,
      toolUses: n("tool_uses") ?? 0,
      ms: n("duration_ms") ?? 0,
      agentId: text.match(/agentId:\s*(\S+)/)?.[1] ?? null,
    };
  }

  function flushText(s) {
    if (!s.partial.trim()) {
      s.partial = "";
      return;
    }
    emit(s, "text", { text: s.partial });
    s.partial = "";
  }
  function flushThought(s) {
    if (!s.thought.trim()) {
      s.thought = "";
      return;
    }
    emit(s, "thought", { text: s.thought });
    s.thought = "";
  }

  function send(s, frame) {
    if (s.ws?.readyState === s.ws?.OPEN) s.ws.send(JSON.stringify(frame));
  }

  // An event: numbered, remembered, shown, and told to the app.
  function emit(s, kind, body) {
    const record = records[s.id];
    const event = {
      seq: ++record.seq,
      kind,
      body,
      at: new Date().toISOString(),
    };
    saveRecords().catch((err) => log(`sessions.json: ${err.message}`));
    if (kind === "prompt" || kind === "wake") s.recent = [];
    s.recent.push(event);
    if (s.recent.length > 500) s.recent.shift();
    send(s, { event });
    s.queue.push({ seq: event.seq, kind, body });
    post(s);
    return event;
  }

  // Events go to the app in order; a batch that fails waits for the next.
  function post(s) {
    if (s.posting || s.queue.length === 0) return;
    const batch = s.queue.splice(0, s.queue.length);
    s.posting = call("report", {
      session: s.id,
      acpSessionId: s.acpId,
      events: batch,
    })
      .catch((err) => {
        // A conversation the app no longer takes: its harness stops here,
        // whatever it was doing.
        if (err.status === 404) return forget(s);
        log(`agent ${s.id.slice(0, 8)}: events not reported (${err.message})`);
        s.queue.unshift(...batch);
      })
      .finally(() => {
        s.posting = null;
        if (s.queue.length) setTimeout(() => post(s), 5000).unref();
      });
  }

  // A prompt from the person, or, with a wakeup, one the daemon fires for a
  // harness that has since restarted and lost its timer.
  async function prompt(s, text, wakeup = null) {
    if (s.turn) {
      send(s, { error: "The agent is still working. Stop it first, or wait." });
      return;
    }
    const record = records[s.id];
    const started = wakeup
      ? emit(s, "wake", { prompt: text, reason: wakeup.reason })
      : emit(s, "prompt", { text });
    s.turn = { since: started.at };
    record.turn = true;
    record.since = started.at;
    try {
      await saveRecords();
      const res = await s.agent.request(acp.methods.agent.session.prompt, {
        sessionId: s.acpId,
        prompt: [{ type: "text", text }],
      });
      finish(s, res.stopReason, res.usage ?? null, null);
    } catch (err) {
      // A harness stopped under its turn keeps the turn on the record, for
      // the restore that follows.
      if (s.stopping) return;
      finish(s, "error", null, err.message);
    }
  }

  function finish(s, stopReason, usage, error) {
    if (!s.turn) return;
    flushThought(s);
    flushText(s);
    for (const tool of s.tools.values())
      emit(s, "tool", { ...tool, status: tool.status ?? "completed" });
    s.tools.clear();
    const ms = Date.now() - new Date(s.turn.since).getTime();
    emit(s, "result", {
      stopReason,
      ms,
      usage: usage
        ? {
            input: usage.inputTokens ?? 0,
            output: usage.outputTokens ?? 0,
            cacheRead: usage.cachedReadTokens ?? 0,
            cacheWrite: usage.cachedWriteTokens ?? 0,
          }
        : null,
      ...(error ? { error } : {}),
    });
    if (error) send(s, { error: `The agent failed: ${error}` });
    s.turn = null;
    const record = records[s.id];
    record.turn = false;
    record.since = null;
    saveRecords().catch(() => {});
    armIdle(s);
  }

  // With nobody watching and nothing running, the harness is stopped after a
  // while; not while a cron stands, and not before a wakeup it scheduled
  // has had its turn.
  function armIdle(s) {
    if (s.idle) clearTimeout(s.idle);
    if (s.ws || s.turn) return;
    const record = records[s.id];
    if (record.crons.length > 0) return;
    const last = Math.max(0, ...record.wakeups.map((w) => w.at + WAKE_GRACE));
    const delay = Math.max(IDLE, last - Date.now());
    s.idle = setTimeout(() => {
      if (!s.ws && !s.turn) stop(s);
    }, delay);
    s.idle.unref();
  }

  function stop(s) {
    s.stopping = true;
    if (s.idle) clearTimeout(s.idle);
    s.idle = null;
    if (live.get(s.id) === s) live.delete(s.id);
    s.proc?.kill();
  }

  // Every harness stopped, as when the system under them is reset; what
  // was mid-turn is restored afterwards like after a boot.
  async function stopAll() {
    for (const s of [...live.values()]) {
      s.ws?.close(1000, "The system is being reset. Reload in a minute.");
      s.ws = null;
      stop(s);
    }
    // One still coming up is waited for and stopped, so nothing that
    // follows starts over a dying one.
    await Promise.all(
      [...pending.values()].map((p) => p.then(stop).catch(() => {})),
    );
  }

  // A conversation the app will not take events for, deleted or no longer
  // this machine's: the harness is stopped and nothing brings it back here.
  // The transcript's name stays, for a machine that may yet own it.
  // Deleted on the page: the turn is cancelled, the harness stopped, and
  // nothing of it is kept here.
  function end(s) {
    if (s.turn && s.acpId)
      s.agent
        ?.notify(acp.methods.agent.session.cancel, { sessionId: s.acpId })
        .catch(() => {});
    forget(s);
    delete records[s.id];
    saveRecords().catch(() => {});
  }

  function forget(s) {
    s.ws?.close(1000, "This conversation is no longer running here.");
    s.ws = null;
    s.turn = null;
    s.queue.length = 0;
    stop(s);
    const record = records[s.id];
    if (record) {
      record.turn = false;
      record.wakeups = [];
      record.crons = [];
      saveRecords().catch(() => {});
    }
  }

  // One start per session at a time: a second asker waits on the first.
  function starting(id) {
    const s = live.get(id);
    if (s) return Promise.resolve(s);
    const p = pending.get(id) ?? start(id).finally(() => pending.delete(id));
    pending.set(id, p);
    return p;
  }
  const pending = new Map();

  function snapshot(s) {
    return {
      snapshot: {
        working: Boolean(s.turn),
        since: s.turn?.since ?? null,
        partial: s.partial,
        tools: [...s.tools.values()],
        tasks: [...s.tasks.values()],
        // The turn's events so far, for a page that opened during it.
        events: s.turn ? s.recent : [],
      },
    };
  }

  // A browser's socket for a session: the harness is started if it is not
  // running, and everything from here on is shown to this socket.
  async function attach(ws, id) {
    await restored;
    // What the browser says while the harness is still starting is kept,
    // not dropped: the first prompt of a new conversation arrives at once.
    let s = live.get(id);
    let ready = Boolean(s);
    const early = [];
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      if (ready && !s.stopping) handle(s, data);
      else if (!ready) early.push(data);
    });
    if (!s) {
      try {
        s = await starting(id);
      } catch (err) {
        log(`agent ${id.slice(0, 8)}: ${err.message}`);
        return ws.close(
          1011,
          `The agent could not start: ${err.message}`.slice(0, 120),
        );
      }
    }
    // A browser that left while the harness was starting is not waited
    // for: the harness idles out as if nobody had come.
    if (ws.readyState !== ws.OPEN) return armIdle(s);
    if (s.idle) clearTimeout(s.idle);
    s.idle = null;
    s.ws?.close(1000, "Picked up elsewhere.");
    s.ws = ws;
    ws.send(JSON.stringify({ status: s.fake ? "faked" : "ready" }));
    ws.send(JSON.stringify(snapshot(s)));
    ready = true;
    for (const data of early) handle(s, data);
    ws.on("close", () => {
      if (s.ws !== ws) return;
      s.ws = null;
      armIdle(s);
    });
  }

  // What the browser asked: a prompt, a stop, or another model.
  function handle(s, data) {
    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof frame.prompt === "string" && frame.prompt.trim())
      prompt(s, frame.prompt.trim());
    else if (frame.end) end(s);
    else if (frame.cancel && s.turn && s.acpId)
      s.agent
        .notify(acp.methods.agent.session.cancel, { sessionId: s.acpId })
        .catch(() => {});
    else if (
      typeof frame.model === "string" &&
      frame.model &&
      frame.model !== s.model
    )
      changeModel(s, frame.model);
  }

  // A new model is a new harness process on the same transcript.
  async function changeModel(s, model) {
    if (s.turn)
      return send(s, {
        error: "Wait for the agent to finish before changing the model.",
      });
    records[s.id].model = model;
    emit(s, "model", { model });
    // The new harness reads its model from the app, which must have heard.
    await s.posting;
    const ws = s.ws;
    s.ws = null;
    stop(s);
    await attach(ws, s.id).catch((err) =>
      log(`agent ${s.id.slice(0, 8)}: ${err.message}`),
    );
  }

  // On boot: whatever was mid-turn when the machine went down is told so,
  // brought back from its transcript, and told to carry on. The app hears
  // which those are, so a turn this machine has no record of any more — a
  // disk put back from a backup, a scratch disk wiped — is finished there
  // instead of working forever.
  async function restore() {
    try {
      await loadRecords();
      const cut = Object.entries(records).filter(([, r]) => r.turn);
      await call("boot", { inFlight: cut.map(([id]) => id) }).catch((err) =>
        log(`agent: boot not reported (${err.message})`),
      );
      for (const [id, record] of cut) {
        record.turn = false;
        starting(id)
          .then((s) => {
            emit(s, "restart", { since: record.since });
            prompt(s, RESTARTED).catch(() => {});
          })
          .catch((err) =>
            log(`agent ${id.slice(0, 8)}: not restored (${err.message})`),
          );
      }
    } finally {
      loaded();
    }
    // A harness that set a wakeup or a cron is started again: the cron it
    // keeps in its own files re-arms there; the wakeup is fired by the
    // daemon, as for any harness started over a record.
    for (const [id, record] of Object.entries(records)) {
      if (!record.wakeups?.length && !record.crons?.length) continue;
      try {
        const s = await starting(id);
        armIdle(s);
      } catch (err) {
        log(`agent ${id.slice(0, 8)}: schedule not restored (${err.message})`);
      }
    }
    await saveRecords();
  }

  return { attach, restore, stopAll, live };
}
