#!/usr/bin/env node
/**
 * Entrypoint: boots the MCP server over stdio.
 *
 * NOTE: stdout is reserved for the MCP protocol (JSON-RPC). All diagnostic
 * logging MUST go to stderr, otherwise it corrupts the protocol stream.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { runSetup } from "./setup.js";

async function main(): Promise<void> {
  if (process.argv[2] === "setup") {
    await runSetup();
    return;
  }

  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const mode = config.mock ? " [MOCK mode]" : "";
  process.stderr.write(
    `[gitlab-duo-mcp-bridge] ready. tool="${config.toolName}" ` +
      `command="${config.command} ${config.baseArgs.join(" ")}"${mode}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[gitlab-duo-mcp-bridge] fatal: ${String(err)}\n`);
  process.exit(1);
});
