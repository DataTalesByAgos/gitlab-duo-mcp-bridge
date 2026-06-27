/**
 * End-to-end smoke test for the MCP server over stdio (in MOCK mode).
 *
 * Spawns the built server, performs the MCP handshake, lists tools, calls
 * `duo_review`, and asserts the normalized structured result. Run with:
 *   node scripts/smoke.mjs
 * (run `npm run build` first).
 */

import { spawn } from "node:child_process";
import process from "node:process";

const SERVER = "dist/src/index.js";

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function notify(method, params) {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

async function main() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DUO_MOCK: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = new Map();
  const waiters = new Map();
  let buffer = "";

  const waitFor = (id) =>
    new Promise((resolve, reject) => {
      if (responses.has(id)) return resolve(responses.get(id));
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for response id=${id}`)),
        15000,
      );
      waiters.set(id, { resolve, reject, timer });
    });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line === "") continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && msg.id !== null) {
        responses.set(msg.id, msg);
        const w = waiters.get(msg.id);
        if (w) {
          clearTimeout(w.timer);
          waiters.delete(msg.id);
          w.resolve(msg);
        }
      }
    }
  });

  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  const send = (line) => child.stdin.write(line + "\n");

  // 1) initialize
  send(
    rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0.0.0" },
    }),
  );
  const init = await waitFor(1);
  assert(init.result, "initialize returned a result");

  // 2) initialized notification
  send(notify("notifications/initialized", {}));

  // 3) tools/list
  send(rpc(2, "tools/list", {}));
  const list = await waitFor(2);
  const tools = list.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  assert(names.includes("duo_review"), `duo_review tool is registered (got: ${names.join(", ")})`);

  // 4) tools/call
  send(
    rpc(3, "tools/call", {
      name: "duo_review",
      arguments: { diff: "--- a\n+++ b\n+const x = 1;" },
    }),
  );
  const call = await waitFor(3);
  const structured = call.result?.structuredContent;
  assert(structured, "tools/call returned structuredContent");
  assert(structured.ok === true, "structured.ok is true in mock mode");
  assert(structured.degraded === false, "structured.degraded is false (JSON parsed)");
  assert(Array.isArray(structured.issues) && structured.issues.length === 2, "got 2 normalized issues");
  assert(structured.issues[0].severity === "high", "first issue severity is high");
  assert(structured.meta.mock === true, "meta.mock is true");

  console.log("SMOKE OK: handshake + tools/list + duo_review(mock) all passed.");
  console.log(JSON.stringify(structured, null, 2));

  child.stdin.end();
  child.kill();
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err.message);
  process.exit(1);
});
