#!/usr/bin/env node
// The browser as an MCP server on stdio: what Claude Code on a computer
// connects to.
import { serve } from "../src/server.ts";

await serve();
