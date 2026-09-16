// Three things the Agent window needs of claude-code-acp that it does not
// have, put into its installed copy when the image is built: a prompt sent
// while one is running joins the running turn, as a word typed into Claude
// Code's own terminal does, instead of a second reader fighting the first
// for one stream; a conversation the door leaves is closed, so its Claude
// Code process goes with it rather than staying for the life of the
// machine; and a question the agent asks the person, which the adapter
// switches off, is asked of the client as a request of our own and the
// answers handed back into the tool. Run from /opt/maslow after npm install; a copy of the
// adapter this no longer fits stops the build here.
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
            s.input.push(promptToClaude(params));
            return { stopReason: "end_turn" };
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

put(
  `        const disallowedTools = ["AskUserQuestion"];`,
  `        const disallowedTools = [];`,
);
put(
  `            if (toolName === "ExitPlanMode") {`,
  `            if (toolName === "AskUserQuestion") {
                const said = await this.client.extMethod("_maslow/ask", {
                    sessionId,
                    toolCallId: toolUseID,
                    questions: toolInput?.questions ?? [],
                });
                if (signal.aborted) {
                    throw new Error("Tool use aborted");
                }
                return {
                    behavior: "allow",
                    updatedInput: { ...toolInput, answers: said?.answers ?? {} },
                };
            }
            if (toolName === "ExitPlanMode") {`,
);

fs.writeFileSync(at, s);
console.log("patch-acp: applied");
