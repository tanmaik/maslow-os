// Four things the Agent window needs of claude-code-acp that it does not
// have, put into its installed copy when the image is built: in auto the
// person's own tools go through and only a command asks; one prompt at
// a time, since the door sends the next word of a running turn itself by
// stopping the turn and prompting it on, and a second reader would fight
// the first for one stream; a conversation the door leaves is closed, so
// its Claude Code process goes with it rather than staying for the life of
// the machine; and a question the agent asks the person, which the adapter
// switches off, is put to the door, which leaves it with the person as an
// ask of the brain's — the answer comes back as the next word, so the tool
// is refused with that said and the turn ends. Run from /opt/maslow after
// npm install; a copy of the adapter this no longer fits stops the build
// here.
import fs from "node:fs";

const at = "node_modules/@zed-industries/claude-code-acp/dist/acp-agent.js";
let s = fs.readFileSync(at, "utf8");
const put = (a, b) => {
  if (!s.includes(a))
    throw new Error(`patch-acp: not found: ${a.slice(0, 80)}`);
  s = s.replace(a, b);
};

put(
  `    async prompt(params) {
        if (!this.sessions[params.sessionId]) {
            throw new Error("Session not found");
        }
        this.sessions[params.sessionId].cancelled = false;`,
  `    async prompt(params) {
        const s = this.sessions[params.sessionId];
        if (!s) {
            throw new Error("Session not found");
        }
        if (s.busy) {
            throw new Error("A turn is running; stop it before the next word.");
        }
        s.busy = true;
        try {
            return await this.promptOnce(params);
        }
        finally {
            s.busy = false;
        }
    }
    async extMethod(method, params) {
        if (method !== "_maslow/close") {
            throw new Error("Method not found");
        }
        const s = this.sessions[params?.sessionId];
        if (s) {
            s.cancelled = true;
            delete this.sessions[params.sessionId];
            try {
                await s.query.interrupt();
            }
            catch { }
            s.input.end();
        }
        return {};
    }
    async promptOnce(params) {
        if (!this.sessions[params.sessionId]) {
            throw new Error("Session not found");
        }
        this.sessions[params.sessionId].cancelled = false;`,
);

// In auto the person's own tools go through: the brain, the browser,
// BoardUI, and the door's wakeup unless it carries a command, which asks
// as any command does. A wakeup let through is let through once, never as
// a standing rule, so the next one is looked at.
put(
  `                (session.permissionMode === "acceptEdits" && EDIT_TOOL_NAMES.includes(toolName))) {
                return {
                    behavior: "allow",
                    updatedInput: toolInput,
                    updatedPermissions: suggestions ?? [`,
  `                (session.permissionMode === "acceptEdits" && (EDIT_TOOL_NAMES.includes(toolName) || (toolName.startsWith("mcp__") && !(toolName === "mcp__maslow__wakeup" && toolInput?.command))))) {
                return {
                    behavior: "allow",
                    updatedInput: toolInput,
                    updatedPermissions: toolName === "mcp__maslow__wakeup" ? [] : suggestions ?? [`,
);

put(
  `        const disallowedTools = ["AskUserQuestion"];`,
  `        const disallowedTools = [];`,
);
put(
  `            if (toolName === "ExitPlanMode") {`,
  `            if (toolName === "AskUserQuestion") {
                let said;
                try {
                    said = await this.client.extMethod("_maslow/ask", {
                        sessionId,
                        toolCallId: toolUseID,
                        questions: toolInput?.questions ?? [],
                    });
                }
                catch (err) {
                    return {
                        behavior: "deny",
                        message: \`The question could not be put to the person: \${err?.message ?? err}\`,
                    };
                }
                const ids = said?.asked ?? [];
                return {
                    behavior: "deny",
                    message: \`Asked the person: notification\${ids.length === 1 ? "" : "s"} \${ids.join(", ")}, in the thread and behind the clock. Their answer arrives as your next message, so end your turn now and wait for it; the brain's notifications tool reads it back too.\`,
                };
            }
            if (toolName === "ExitPlanMode") {`,
);

fs.writeFileSync(at, s);
console.log("patch-acp: applied");
