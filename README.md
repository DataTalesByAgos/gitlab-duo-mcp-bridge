# gitlab-duo-mcp-bridge

A tiny **MCP server** that wraps the **GitLab Duo CLI** as a single, clean,
fault-tolerant tool: **`duo_review`**.

Connect it to any MCP-capable coding agent (Claude Code, opencode, Codex,
Gemini CLI, ...). The agent calls `duo_review` like any other tool, the bridge
runs Duo headless under the hood, **normalizes whatever Duo prints into a stable
JSON structure**, and hands it back. Your agent then acts on the findings (e.g.
writes the fixes locally).

```
   ┌────────────────────┐   tools/call duo_review   ┌──────────────────────┐
   │  Your coding agent  │ ────────────────────────▶ │ gitlab-duo-mcp-bridge │
   │ (Claude Code, etc.) │ ◀──────────────────────── │   (this MCP server)   │
   └────────────────────┘   normalized JSON result  └───────────┬──────────┘
                                                                 │ spawn (headless)
                                                                 ▼
                                                      ┌──────────────────────┐
                                                      │  GitLab Duo CLI       │
                                                      │  glab duo cli run ... │
                                                      └──────────────────────┘
```

### Why a bridge?

Duo's headless output is **agentic text**, not a guaranteed JSON API. If you
parse its stdout ad-hoc in each agent, it breaks on every Duo update. This
bridge isolates that fragility in **one place** behind a versioned tool:

- It **asks** Duo for JSON, but **never trusts** that it gets it.
- The normalizer extracts JSON from prose, from ```` ```json ```` fences, from a
  trailing object after commentary, or from a top-level array — and **degrades
  gracefully to plain text** when there is no JSON at all.
- It **never throws**: launch failures and timeouts come back as structured
  results with `isError`, so your agent stays in control.

## Requirements

- **Node.js >= 20** (tested on 24).
- The **GitLab Duo CLI**, reachable from your shell. Most setups use the GitLab
  CLI extension: `glab duo cli run --goal "..."`. The standalone `duo` binary
  works too. The exact command is **fully configurable** (see below), and you
  can develop without it using **MOCK mode**.

## Install & build

```bash
npm install
npm run build      # compiles TypeScript to dist/
```

Quick checks:

```bash
npm test           # unit tests (normalizer + goal builder)
npm run smoke      # end-to-end MCP handshake in MOCK mode (no Duo needed)
```

## Configuration (environment variables)

All optional; defaults assume `glab duo cli run --goal "<goal>"`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DUO_CLI_COMMAND` | `glab` | Executable to launch. |
| `DUO_CLI_BASE_ARGS` | `duo cli run` | Sub-command args (space separated). |
| `DUO_CLI_GOAL_FLAG` | `--goal` | Flag that carries the prompt. |
| `DUO_CLI_MODEL_FLAG` | `--model` | Flag that carries the model. |
| `DUO_CLI_EXTRA_ARGS` | _(empty)_ | Extra args appended to every call. |
| `GITLAB_DUO_MODEL` | _(none)_ | Default model (e.g. `gpt_5_codex`). |
| `DUO_CLI_CWD` | bridge cwd | Working directory Duo runs in. |
| `DUO_TIMEOUT_MS` | `120000` | Per-run timeout (ms). |
| `DUO_MAX_OUTPUT_CHARS` | `100000` | Max raw output kept in `raw`. |
| `DUO_MAX_INLINE_GOAL_CHARS` | `7000` | Above this prompt size, the goal (big diffs) is sent via a temp file instead of inline (avoids `ENAMETOOLONG`). |
| `DUO_TOOL_NAME` | `duo_review` | Tool name registered with MCP. |
| `DUO_MOCK` | _(off)_ | `1`/`true` → return a canned review (no Duo). |
| `GITLAB_TOKEN`, `GITLAB_BASE_URL` | _(none)_ | Passed through to the Duo subprocess. |

The bridge invokes:

```
<DUO_CLI_COMMAND> <DUO_CLI_BASE_ARGS> <DUO_CLI_GOAL_FLAG> "<goal>" [<DUO_CLI_MODEL_FLAG> <model>] <DUO_CLI_EXTRA_ARGS>
```

The goal string is passed as a **single argv entry** with `shell: false` — no
shell, no injection, no quoting issues.

> **About the tool name:** it defaults to `duo_review` (underscore) because some
> MCP clients reject dots in tool names. If your client allows it and you prefer
> the `duo.review` spelling, set `DUO_TOOL_NAME=duo.review`.

## The `duo_review` tool

**Input** (all optional):

| Field | Type | Description |
| --- | --- | --- |
| `diff` | string | Unified diff to review (e.g. `git diff`). |
| `files` | string[] | Paths to focus on. |
| `instructions` | string | Extra guidance for the reviewer. |
| `goal` | string | Override the whole prompt sent to Duo. |
| `cwd` | string | Working dir for this call. |
| `model` | string | Model override for this call. |
| `timeoutMs` | number | Timeout override for this call. |

**Output** (`structuredContent`):

```jsonc
{
  "ok": true,            // Duo exited 0 and did not time out
  "degraded": false,     // true => could not parse JSON, see summary/raw
  "summary": "…",        // review summary (or raw text when degraded)
  "issues": [
    {
      "type": "security",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "file": "src/auth.ts" | null,
      "line": 42 | null,
      "message": "…",
      "suggestion": "…" | null
    }
  ],
  "raw": "…",            // raw (truncated) Duo output, for debugging
  "meta": {
    "commandLine": "glab duo cli run --goal <goal>",
    "exitCode": 0,
    "timedOut": false,
    "durationMs": 1234,
    "mock": false,
    "parseError": null,
    "goalViaFile": false  // true => prompt was too big and sent via a temp file
  }
}
```

A human-readable text version is also returned in `content` for agents that
don't read `structuredContent`.

## Connect it to your agent

Point your MCP client at the built entrypoint with `command: node`,
`args: ["<abs>/dist/src/index.js"]`. Examples:

### Claude Code

```bash
claude mcp add gitlab-duo --env DUO_MOCK=1 -- node /abs/path/gitlab-duo-mcp-bridge/dist/src/index.js
# verify inside Claude Code:
/mcp
```

(Drop `--env DUO_MOCK=1` once your real Duo CLI is set up.)

### opencode / Codex / Gemini CLI (generic stdio config)

```jsonc
{
  "mcpServers": {
    "gitlab-duo": {
      "command": "node",
      "args": ["/abs/path/gitlab-duo-mcp-bridge/dist/src/index.js"],
      "env": {
        "DUO_CLI_COMMAND": "glab",
        "DUO_CLI_BASE_ARGS": "duo cli run"
        // "DUO_MOCK": "1"  // uncomment to test without Duo
      }
    }
  }
}
```

Then, in a session, ask your agent something like:

> "Review this diff with `duo_review`, then apply the high-severity fixes here
> in my local repo."

## Try it without Duo (MOCK mode)

```bash
DUO_MOCK=1 node dist/src/index.js     # or set env in your MCP client
```

`duo_review` returns a realistic canned review so you can wire up and validate
the whole flow in your agent **before** installing/authenticating Duo.

## Fault tolerance, at a glance

- **Huge diff / prompt?** (would overflow the OS command line, e.g.
  `ENAMETOOLONG` on Windows) → the goal is written to a temp file in the working
  directory, Duo is asked to read it, and the file is deleted afterwards
  (`meta.goalViaFile: true`). Threshold: `DUO_MAX_INLINE_GOAL_CHARS`.
- **No JSON?** → `degraded: true`, full text in `summary`/`raw`, `issues: []`.
- **JSON in a fence / after prose / as an array?** → still parsed and normalized.
- **Weird field names / severities?** (`findings`, `priority`, `blocker`, …) →
  mapped to the canonical schema.
- **Duo not installed / wrong command?** → `isError: true` with an actionable
  message (no crash).
- **Timeout?** → process is killed; result comes back with `timedOut: true`.

## Project layout

```
src/
  index.ts       # stdio entrypoint (logs to stderr only)
  server.ts      # registers duo_review, orchestrates the flow
  config.ts      # env-based configuration (+ MOCK)
  goal.ts        # builds the review prompt (asks Duo for JSON)
  duoRunner.ts   # safe subprocess wrapper (spawn, timeout, never throws)
  goalFile.ts    # large-goal fallback (temp file + pointer goal + cleanup)
  normalizer.ts  # fault-tolerant output normalizer (the core)
test/            # unit tests (node:test)
scripts/smoke.mjs# end-to-end MCP handshake smoke test (MOCK)
```

## License

MIT
