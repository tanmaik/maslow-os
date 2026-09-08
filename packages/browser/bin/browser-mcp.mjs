#!/usr/bin/env node
// The browser as an MCP server: on stdio for a client that starts it, or
// over HTTP on the machine itself with `--http <port>`, as a computer
// runs it for Claude Code inside.
import { serve } from "../src/server.ts";

const at = process.argv.indexOf("--http");
await serve(at === -1 ? undefined : Number(process.argv[at + 1]));
