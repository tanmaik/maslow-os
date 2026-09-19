# The door's protocol, as the web app speaks it

What a native iPhone client has to do to talk to a person's computer the way
the Agent window does. Read from the code on branch `iphone`; every claim
carries a `file:line`.

## 1. The ticket and the address

The browser never knows the machine's address. It asks our server, which
answers both the address and a ticket, and then dials the machine directly.

`apps/web/app/computer/live/route.ts:6-13` — `GET /computer/live`, signed-in
only (`principal()`), 409 with a sentence when there is no ready computer:

```json
{ "door": "wss://<machineId>.<FLY_MACHINES_DOMAIN>", "ticket": "<exp>.<hmac>" }
```

`apps/web/lib/computer.ts:1428-1440` (`liveTarget`) builds it from the ready
computer, falling back to `awoken()` (`:1442-1451`) so a machine whose row was
reset by an update is marked ready again the moment its door answers.

The ticket: `apps/web/lib/computer.ts:1258-1262`

```
whole machine: `${exp}.${hmac_sha256(c.secret, exp)}`
one port:      `${exp}.${port}.${hmac_sha256(c.secret, `${exp}.${port}`)}`
```

`exp` is unix seconds. `liveTarget` mints **3600 s** (one hour), scope empty =
whole machine. `openLink` and a shared port's link each mint `SHARED_FOR = 3600` for the
one port they open; nothing mints a ticket for the whole machine as a page. The secret is
the computer's row secret, held only by our server and that machine
(`DOOR_SECRET` on the machine, `apps/computer/door.mjs:28`).

The door verifies with `scopeOf` (`apps/computer/door.mjs:52-67`): 2 or 3
dot-parts, expiry in the future, HMAC compared with `timingSafeEqual`. The
door's own sockets require scope `""` — `ours()` at `:71`, checked at
`:867-870`.

Client → machine, exactly what the web does (`apps/web/lib/live.ts:5-21`):

```
wss://<machineId>.<domain>/maslow/<agent|talk|view>?ticket=<ticket>[&k=v...]
```

No subprotocol, no headers, no cookie, no Origin check on the door's own
sockets (`apps/computer/door.mjs:855-872`; the Origin/cookie checks at
`:876-892` apply only to a person's _ports_). `binaryType = "arraybuffer"`.
The socket resolves on open and rejects on close.

The WebSocket server is hand-rolled (`apps/computer/door.mjs:2606-2700`): RFC
handshake, text (0x1) and binary (0x2) frames, fragmentation, ping answered
with pong, close honoured. **It never sends pings of its own** — keepalive is
the client's job. Server frames are unmasked; client frames must be masked
(standard).

Other doors on the same host, same ticket: `PUT https://<machine>.<domain>/maslow/files/upload?path=&total=&modified=&offset=` with header
`x-maslow-ticket` (ticket from `POST /computer/files/upload`, which returns
`{door,ticket}` where door = `https://<machine>.<domain>/maslow/files`) —
`apps/web/app/computer/agent/agent.tsx:225-252`, `apps/web/lib/computer.ts:1415-1427`.

Auth for our own routes is already phone-ready: `principal()` takes the
`session` cookie **or** `Authorization: Bearer <token>`
(`apps/web/lib/session.ts:38-44`) — "the phone carries the same session as a
bearer token". `apps/iphone/Maslow/Model/API.swift:118` already sends it.

## 2. The Agent socket: `/maslow/agent`

`apps/computer/door.mjs:2440-2604` (`agent(ws)`). It is raw Agent Client
Protocol (JSON-RPC 2.0, one JSON object per text frame) **plus** an
out-of-band namespace `{"maslow": …}` for what belongs to the door rather
than the agent. One `claude-code-acp` process per machine, shared by every
socket; the door is its only client.

### On connect, the door pushes, in order

1. The hello (`:1767-1775`, sent at `:2443`):

```json
{
  "maslow": {
    "clear": true,
    "state": "off|starting|ready|failed",
    "why": null,
    "chats": [
      {
        "id": "<uuid>",
        "running": false,
        "modes": {
          "currentModeId": "acceptEdits",
          "availableModes": [
            { "id": "default", "name": "…", "description": null }
          ]
        },
        "title": "Fixing the build"
      }
    ]
  }
}
```

`chatSaid` at `:1746-1752`.

2. Every kept line of every open conversation, replayed verbatim
   (`:2444-2447`) — the ring buffer is the last `KEPT = 2000` messages
   (`:1530`, `:2205-2206`).
3. `tellContext` per chat (`:1930-1933`) → `{"maslow":{"chat":{"id","context"}}}`.
4. Every live agent terminal's output (`:2450-2455`).

### What the client sends

| Intent                  | Frame                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| handshake               | `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}}` |
| new conversation        | `{"maslow":{"fresh":true}}`                                                                                                                                               |
| open/resume one         | `{"maslow":{"open":"<sessionId>"}}`                                                                                                                                       |
| close one               | `{"maslow":{"close":"<sessionId>"}}`                                                                                                                                      |
| rename                  | `{"maslow":{"name":{"id":"<sessionId>","title":"…"}}}`                                                                                                                    |
| list conversations      | `{"jsonrpc":"2.0","id":n,"method":"session/list","params":{}}`                                                                                                            |
| prompt                  | `{"jsonrpc":"2.0","id":n,"method":"session/prompt","params":{"sessionId":"…","prompt":[{"type":"text","text":"…"}]}}`                                                     |
| stop                    | `{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"…"}}` (notification, no id)                                                                            |
| set mode                | `{"jsonrpc":"2.0","id":n,"method":"session/set_mode","params":{"sessionId":"…","modeId":"acceptEdits"}}`                                                                  |
| answer a permission ask | `{"jsonrpc":"2.0","id":<askId>,"result":{"outcome":{"outcome":"selected","optionId":"…"}}}`                                                                               |
| answer a questionnaire  | `{"jsonrpc":"2.0","id":<askId>,"result":{"answers":{"<question text>":"<labels, joined>"}}}`                                                                              |

Sources: `apps/web/app/computer/agent/chats.tsx:362-377` (initialize),
`:396-411` (fresh/open/name), `:414-421` (prompt), `:424-434` (cancel),
`:435-444` (answer), `:447-454` (set_mode), `:164-168` (list);
`apps/web/app/computer/agent/thread.tsx:455` (permission outcome), `:419-433`
(questionnaire answers).

There is **no fork and no model switch**. Fork does not exist in the code; the
model is fixed and merely named in the composer — `MODEL = "GLM 5.3 Flash"`,
`apps/web/app/computer/agent/agent.tsx:42`.

Prompt content may be text, or an image inline, or a link to a file already
uploaded: `Content` at `apps/web/app/computer/agent/acp.ts:6-13` —
`{"type":"image","data":"<base64>","mimeType":"image/png"}`,
`{"type":"resource_link","uri":"file:///home/me/Attachments/x.pdf","name":"x.pdf"}`.

Door-side handling of the client's frames (`:2458-2604`):

- `initialize` is answered from the cached `room.init` — the process is
  initialized once, so **the client's declared capabilities are ignored**
  (`:2477-2497`). The door told the agent `terminal: true` and
  `fs.read/write: false` (`:2337-2349`).
- Every id-bearing call is renumbered under the door's own counter so two
  clients cannot steal each other's answers (`:2519`).
- `session/prompt` for a sleeping session opens it first, then retries
  (`:2506-2518`). The person's words are echoed back to every socket as a
  `user_message_chunk` so the transcript holds them (`:2527-2545`).
- A prompt sent while one runs is _steering_: it joins the running turn and
  does not flip `running` (`:2521-2525`, adapter patch
  `apps/computer/patch-acp.mjs:27-43`).
- `session/list` answers are overlaid with door-kept titles (`titled`,
  `:1920-1929`).
- An answer to an ask (no `method`, has `id`) is matched against every chat's
  ring, removed from it, and relayed under the agent's own number
  (`:2586-2601`).

### What the door sends

Everything the agent says, verbatim, to every socket (`fromAgent` →
`toWatchers`, `:2192-2219`, `:1935-1938`), plus `maslow` words. Session
updates arrive as:

```json
{"jsonrpc":"2.0","method":"session/update",
 "params":{"sessionId":"<uuid>","update":{ … }}}
```

`update` shapes (`apps/web/app/computer/agent/acp.ts:80-95`):

```json
{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"…"}}
{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"…"}}
{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"…"}}
{"sessionUpdate":"tool_call","toolCallId":"t1","title":"`ls -la`","kind":"execute",
 "status":"pending","content":[],"_meta":{"claudeCode":{"toolName":"Bash"}}}
{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed",
 "content":[{"type":"content","content":{"type":"text","text":"…"}},
             {"type":"diff","path":"/home/me/a.ts","oldText":null,"newText":"…"},
             {"type":"terminal","terminalId":"t3"}]}
{"sessionUpdate":"plan","entries":[{"content":"…","status":"pending|in_progress|completed"}]}
{"sessionUpdate":"current_mode_update","currentModeId":"acceptEdits"}
{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"review","description":"…"}]}
```

`kind` ∈ read|edit|delete|move|search|execute|think|fetch|switch_mode|other;
`status` ∈ pending|in_progress|completed|failed (`acp.ts:16-28`).

Requests the agent makes of the client (answer by id):

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "session/request_permission",
  "params": {
    "sessionId": "…",
    "options": [
      { "optionId": "a", "name": "Allow", "kind": "allow_once" },
      { "optionId": "b", "name": "Always", "kind": "allow_always" },
      { "optionId": "c", "name": "No", "kind": "reject_once" },
      { "optionId": "d", "name": "Never", "kind": "reject_always" }
    ],
    "toolCall": {
      "toolCallId": "t1",
      "title": "`rm -rf x`",
      "kind": "other",
      "rawInput": { "command": "rm -rf x" }
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "_maslow/ask",
  "params": {
    "sessionId": "…",
    "toolCallId": "t1",
    "questions": [
      {
        "question": "Which one?",
        "header": "Pick",
        "multiSelect": false,
        "options": [{ "label": "A", "description": "…" }]
      }
    ]
  }
}
```

`_maslow/ask` is ours: `apps/computer/patch-acp.mjs:71-88` re-enables Claude
Code's `AskUserQuestion` tool and routes it out as this extension method; the
answers go straight back into the tool's input. Read by the client at
`apps/web/app/computer/agent/chats.tsx:311-328`.

The door's own words (`{"maslow":…}`, `Word` at `acp.ts:107-129`):

```json
{"maslow":{"clear":true,"state":"ready","why":null,"chats":[…]}}
{"maslow":{"chat":{"id":"…","clear":true}}}                     // opened afresh; drop the transcript
{"maslow":{"chat":{"id":"…","gone":true}}}                      // asleep or unopenable
{"maslow":{"chat":{"id":"…","running":true}}}
{"maslow":{"chat":{"id":"…","title":"Fixing the build"}}}
{"maslow":{"chat":{"id":"…","context":{"max":1000000,
  "segments":[{"label":"Messages","tokens":1200},
              {"label":"Tools and their output","tokens":8400},
              {"label":"Thinking","tokens":300}]}}}}
{"maslow":{"terminal":{"id":"t3","output":"…","truncated":false,
                       "exitStatus":{"exitCode":0,"signal":null}}}}
```

`running` (`chatRunning`, `:1969-1995`) flips on any of
agent_message/thought/tool_call/tool_call_update/plan and off after `SETTLE =
1000 ms` of quiet with no outstanding prompt and no pending ask (`:1997-2015`);
turning it off also drops any unanswered ask from the ring and tells the door
to send it to nobody. `context` is reckoned from Claude Code's own
`~/.claude/projects/-home-me/<id>.jsonl` at ~4 chars/token against a
1,000,000 window (`:1782-1836`). Titles are generated by one GLM 5.3 Flash
call on OpenRouter after the first exchange (`:1862-1918`). Terminal output is
coalesced to 10 frames/s (`terminalSays`, `:2046-2053`), capped at 1 MiB with
the _tail_ kept (`:2100-2107`).

Spend and the cap are **not** on the socket: `GET /usage` on our server, once
a minute → `{spentUsd, capUsd, resetsAt}`
(`apps/web/app/computer/agent/status.tsx:36-56`, `apps/web/app/usage/route.ts`).

Lifecycle a client must survive: a conversation quiet for `SLEEP = 3 min` is
closed and its process freed (`:1527`, `nap` at `:2017-2020`); the process
dying sends `agentHello(false)` and restarts after 1 s if anyone is watching
(`:2311-2331`); one conversation is kept warm so a new one is instant
(`chatWarm`, `:2401-2417`); the last 8 closed transcripts are held so
re-opening is whole before Claude Code has loaded (`:2225-2232`).

## 3. What the web client does with it — mirror this

`apps/web/app/computer/agent/chats.tsx` is a provider holding one socket for
the whole desk; `agent.tsx` is the window; `thread.tsx` draws it.

- **Connect** (`:342-384`): fetch `/computer/live`, open the socket, send
  `initialize` (answer discarded), set `away = null` only when a
  `state:"ready"` word arrives.
- **Reconnect**: `onclose` → every pending ask resolved `undefined`, `away =
"Reconnecting…"`, retry in **1 s** (`:349-357`); a failed _fetch_ retries in
  **5 s** (`:378-382`). No backoff, no resume token — the door replays.
- **Replay**: `maslow.clear` wipes all chats, all terminal output and the
  known-ids set (`:222-231`); `maslow.chat.clear` resets one chat but keeps
  its title and modes (`:178-184`). So history is _always_ the door's, never
  the client's; nothing is persisted on the device except the rail-open flag,
  the pins and the chosen mode (`agent.tsx:46-47`, `chats.tsx:70`).
- **Transcript folding** (`acp.ts:188-274`): consecutive agent chunks and
  thought chunks concatenate into one item; a person's message is always a new
  item; `tool_call` upserts by `toolCallId`; `tool_call_update` merges title,
  kind, status and replaces content whole; `plan` replaces the single plan
  item. Steps that arrive between an unfinished `Task` call and its result are
  tagged `under: <that toolCallId>` and drawn as the subagent's
  (`acp.ts:176-185`).
- **Mode**: on every `modes` word the device's kept mode (default
  `acceptEdits`) is forced back with `session/set_mode` if the session opened
  on something else (`chats.tsx:193-206`). Names map
  manual/auto/plan/bypass ↔ default/acceptEdits/plan/bypassPermissions
  (`status.tsx:23-34`).
- **Asks** stack under the thread and block nothing; answering removes the ask
  locally and sends the result; `running: false` clears them all
  (`chats.tsx:186-192`, `thread.tsx:578-584`).
- **List**: `session/list` is re-asked whenever a chat first appears, is
  renamed, or the agent goes ready (`chats.tsx:241`, `:251-253`).
- **Words before a conversation exists**: held in a ref, sent the moment
  `newest` lands (`agent.tsx:148-154`).

## 4. The Terminal and View sockets, briefly

**Terminal** — `wss://…/maslow/talk?ticket=…&cols=80&rows=24[&fresh=1]`,
`apps/computer/door.mjs:1011-1154`, client
`apps/web/app/computer/terminal/terminal.tsx:417-505`. A real pty into
`terminal.sh` under tmux session `talk-N`; `fresh=1` only on the very first
connect of a window. Client→door: **binary frames are keystrokes**, verbatim;
text frames are `{"resize":{"cols","rows"}}`, `{"select":<index>}`,
`{"window":"new"}`, `{"rename":{"index","name"}}`, `{"close":<index>}`,
`{"picture":"<base64 png>"}` (a pasted image the machine's `xclip` then
serves). Door→client: **binary is terminal output**; text is
`{"windows":[{"index":0,"on":true,"name":"claude"}]}` (polled 4×/s, sent only
on change) and `{"open":"https://…"}` or `{"open":{"port":3000}}` /
`{"open":{"path":"rel/x.pdf","file":true}}` — something a program on the
machine asked to open (`:524-567`). The session redraws itself, so a client
resets its emulator and re-sends `resize` on every connect.

**View** — `wss://…/maslow/view?ticket=…`, `apps/computer/door.mjs:1161-1259`,
client `apps/web/app/browser/live.tsx:190-300`. Client→door text:
`{"view":true|false}` (start/stop video), `{"size":{"w","h"}}`,
`{"act":{…},"id":n}` for navigate/click/type/key/scroll/select/copy/back/
forward/reload, `{"act":{"kind":"move","x","y"}}` and `{"act":{"kind":"leave"}}`
(unnumbered), `{"tab":…}` / `{"newTab":…}` / `{"closeTab":…}`,
`{"watch":"<rel folder>"}`, `{"ping":<n>}` every 2 s. Door→client: **binary
frames are one H.264 access unit each — first byte 1 for a key frame, then
Annex B** (`frame`, `:1495-1506`); text is `{"size":{"w","h"}}`,
`{"browser":"open"|"closed"}`, `{"tabs":[…],"current":n}`, `{"cursor":"pointer"}`,
`{"changed":"<name>"}`, `{"id":n,"copy":"…"}` or `{"id":n,"why":"…"}`,
`{"pong":n}`. Every viewer gets its own encoder so its first frame is a key
frame; the decoder is configured `avc1.42E01E`, annexb, at the size the door
last announced (`live.tsx:34-42`).

**SSH** — `wss://…/maslow/ssh`, **no ticket**; binary both ways straight to
sshd, the person's public key is the lock (`door.mjs:853-857`, `:907-918`).

## 5. What the door assumes of a browser that a phone must supply itself

- **A session cookie is not needed** — `/computer/live` and `/usage` take
  `Authorization: Bearer <session>` (`apps/web/lib/session.ts:38-44`). Already
  done in `apps/iphone/Maslow/Model/API.swift:118`.
- **No keepalive from the door.** The agent socket has no ping at all; only the
  View client pings. A phone must ping (or reconnect on the OS killing an idle
  socket) and must re-fetch `/computer/live` for a fresh ticket, since a ticket
  lives an hour and is not renewed on a live socket.
- **Backgrounding.** The web client keeps one socket for the whole desk and
  relies on the door's replay. On iOS the socket dies when the app backgrounds:
  reconnect and take the replay; do not persist a transcript.
- **Client capabilities are cosmetic.** The door answers `initialize` from its
  cached handshake, so declaring `terminal: false`/`fs: false` changes nothing
  — the door owns the agent's terminals and streams their output as
  `maslow.terminal` words. A phone must render those, not run anything.
- **`localStorage`** backs three device preferences (mode, rail, pins) —
  needs `UserDefaults`.
- **`visualViewport`** is used to lift the composer above the keyboard
  (`agent.tsx:156-168`) — native keyboard avoidance instead.
- **Attachments**: images are base64'd in the prompt (any size, no cap in the
  code); everything else is a `PUT` upload via `XMLHttpRequest` with progress,
  then a `resource_link`. Needs `URLSession` upload with a progress delegate.
- **Dictation** is `webkitSpeechRecognition` (`agent/speech.ts`) — use
  `SFSpeechRecognizer`.
- **View** needs H.264 Annex B decode from raw WebSocket frames (WebCodecs on
  the web) — `VTDecompressionSession`/`AVSampleBufferDisplayLayer` on iOS. The
  door draws the page at whatever size the client last sent, so the pane size
  must be reported or the picture is letterboxed.
- **Terminal** needs a VT emulator (xterm.js on the web) and must send raw
  bytes as binary frames.
- Nothing else: no cookies, no Origin, no subprotocol, no compression on the
  door's own sockets.
