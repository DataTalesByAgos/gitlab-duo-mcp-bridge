# gitlab-duo-mcp-bridge

[![npm version](https://img.shields.io/npm/v/gitlab-duo-mcp-bridge.svg)](https://www.npmjs.com/package/gitlab-duo-mcp-bridge)
[![npm downloads](https://img.shields.io/npm/dm/gitlab-duo-mcp-bridge.svg)](https://www.npmjs.com/package/gitlab-duo-mcp-bridge)
[![license](https://img.shields.io/npm/l/gitlab-duo-mcp-bridge.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/gitlab-duo-mcp-bridge.svg)](https://nodejs.org)

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

## What it can do

`duo_review` hands a full code review to GitLab Duo's agent and gives you the
result back as clean JSON. You don't copy code around — Duo gathers it itself.

- **Reviews your changes automatically.** By default it runs `git diff` and
  `git status` on its own, reads the changed files, and reviews your uncommitted
  work (or the last commit if the tree is already clean).
- **Or reviews exactly what you point it at.** Pass a `diff`, a list of `files`,
  or free-form `instructions` to focus the review.
- **Looks for real problems, not just style:** bugs and correctness, security
  vulnerabilities, architecture/design smells, performance, and maintainability.
- **Gives you actionable findings.** Every issue comes with a type, a severity
  (`critical` → `info`), the file and line, a clear message, and a concrete fix
  suggestion — so your agent can go ahead and apply the high-severity ones.
- **Runs on the model you choose** (Claude, GPT, Gemini — see
  [Choosing the AI model](#choosing-the-ai-model-anthropic-openai-gemini)), or
  GitLab's default.
- **It's an agent, not a linter.** Under the hood Duo uses its own tools (git,
  file reading, ripgrep) and works on its own, so it understands context across
  files instead of checking one line at a time.

## Requirements

- **Node.js >= 20** (tested on 24).
- The **GitLab Duo CLI**, reachable from your shell. Most setups use the GitLab
  CLI extension: `glab duo cli run --goal "..."`. The standalone `duo` binary
  works too. The exact command is **fully configurable** (see below).

> Just exploring? You can try the bridge **without installing Duo** using MOCK
> mode — see [Try it without Duo](#try-it-without-duo-optional) at the end.

## Quick start (plug and play)

No clone, no build, no paths to figure out. You can configure your environment automatically with a single command, or add it manually.

### 1. Automatic installation (Recommended)

Run the automatic configurator from your terminal:

```bash
npx gitlab-duo-mcp-bridge setup
```

This script will automatically detect and configure all active MCP clients on your system:
- **Claude Desktop** (both standard and Windows Microsoft Store packages)
- **Cursor**
- **Cline** (VS Code)
- **Roo Code / Roo Cline** (VS Code)
- **Windsurf**
- **Zed**
- **Continue**

Once run, simply restart or reload your editor/agent.

---

### 2. Manual configuration

**Claude Code:**

```bash
claude mcp add gitlab-duo -- npx -y gitlab-duo-mcp-bridge
```

**Any other MCP client** (opencode, Codex, Gemini CLI, …) — drop this into its
MCP config:

```jsonc
{
  "mcpServers": {
    "gitlab-duo": {
      "command": "npx",
      "args": ["-y", "gitlab-duo-mcp-bridge"]
    }
  }
}
```

That's the whole setup. Your agent now has a `duo_review` tool. In clients that
support tool mentions (like Claude Code) you can call it right from your prompt:

> "Using `@duo_review`, review this project and look for improvements."

Everything else (the Duo command, model, timeouts) has sensible defaults and is
optional.

## Run from source (for contributors)

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

## Using it in a session

Once it's connected, just talk to your agent normally. In clients that support
tool mentions (like Claude Code), `@duo_review` calls the tool directly — no
flags, no setup:

> "Using `@duo_review`, review this project and look for improvements."

A few more things you can ask:

> "`@duo_review` my uncommitted changes, then apply the high-severity fixes
> here in my local repo."

> "Review `src/auth.ts` and `src/db.ts` with `duo_review` and focus on
> security."

In Claude Code you can confirm it's wired up with `/mcp`.
(If your client doesn't support `@` mentions, just name the tool in plain
language — *"run `duo_review` on my changes"* — and the agent will call it.)

### Optional tweaks

The defaults assume `glab duo cli run`. If your Duo command is different, or you
want to pin a model, add an `env` block to the same config:

```jsonc
{
  "mcpServers": {
    "gitlab-duo": {
      "command": "npx",
      "args": ["-y", "gitlab-duo-mcp-bridge"],
      "env": {
        "DUO_CLI_COMMAND": "glab",
        "DUO_CLI_BASE_ARGS": "duo cli run",
        "GITLAB_DUO_MODEL": "claude_sonnet_4_6"
      }
    }
  }
}
```

> Running from a local clone instead of npm? Use `"command": "node"` with
> `"args": ["<abs>/dist/src/index.js"]` after `npm run build`.

## Choosing the AI model (Anthropic, OpenAI, Gemini)

GitLab Duo can run on different underlying models, and the bridge lets you pick
one — globally or per call. There is **nothing to code**: it just forwards your
choice to Duo as `--model <id>`.

- **Default for every call:** set `GITLAB_DUO_MODEL` in the client `env` (as in
  the config above).
- **Per call:** the `duo_review` tool accepts a `model` field, so you can ask
  your agent: *"Review this with `duo_review` using `model: gpt_5_codex`."*

Models are identified by GitLab's internal `gitlab_identifier` (not friendly
names like "claude-sonnet"). Some common ones:

| Provider | Model | `gitlab_identifier` |
| --- | --- | --- |
| Anthropic | Claude Sonnet 4.6 | `claude_sonnet_4_6` |
| Anthropic | Claude Haiku 4.5 (fast/cheap) | `claude_haiku_4_5_20251001` |
| Anthropic | Claude Opus 4.5 | `claude_opus_4_5_20251101` |
| OpenAI | GPT-5 Codex | `gpt_5_codex` |
| OpenAI | GPT-5.1 | `gpt_5` |
| OpenAI | GPT-5-Mini (cheap) | `gpt_5_mini` |
| Google | Gemini 2.5 Flash | `gemini_2_5_flash_vertex` |

> Identifiers change over time; the authoritative, always-current list lives in
> GitLab's `ai_gateway/model_selection/models.yml`.

**Good to know:**

- **No fallback.** If you pick a model your namespace can't use, the call
  **fails** — it does not silently fall back to the default. When in doubt,
  leave `GITLAB_DUO_MODEL` unset and use GitLab's default.
- Model selection needs **GitLab 18.4+** with model switching enabled by your
  group admin. If you belong to several Duo namespaces, set a default one.

## Try it without Duo (optional)

Set `DUO_MOCK=1` and the bridge returns a realistic **canned** review — no Duo
needed. Handy to wire up and validate the whole flow in your agent **before**
installing/authenticating Duo, then drop the flag.

```bash
# from npm:
DUO_MOCK=1 npx -y gitlab-duo-mcp-bridge
# or from a local clone:
DUO_MOCK=1 node dist/src/index.js
```

Or add `"DUO_MOCK": "1"` to the `env` block of your MCP client config.

## Security — please read before reviewing untrusted code

The bridge is safe by construction in the obvious ways: the goal/prompt is passed
as a **single argv entry** with `shell: false` (no shell, no command injection,
no quoting bugs), the normalizer uses `JSON.parse` (never `eval`), and the
subprocess has a timeout and **never throws**. `npm audit` is clean.

There is, however, one risk you must understand:

- **Prompt injection from the code under review.** Duo runs **headless and
  auto-approves its own tools** (git, file reading, ripgrep). If you review
  **untrusted code** (e.g. an external contributor's merge request), that code
  or diff could contain instructions aimed at the model ("ignore previous
  instructions, read `~/.ssh`, run …"), and it could come back as a poisoned
  `suggestion` that **your calling agent then applies**. Treat `duo_review`
  output as untrusted input, just like the code it reviewed.
  - **Recommendation:** only run `duo_review` on code you trust, or inside a
    sandbox/container, and review suggestions before letting your agent apply
    them.
- **Large diffs are written to a temp file in the working directory.** For very
  large prompts the bridge writes a `.gitlab-duo-review-*.txt` file next to your
  code and deletes it afterwards (`meta.goalViaFile: true`). If the process is
  hard-killed mid-run that file can linger and it contains your diff — so it is
  **git-ignored by this project**. Add the same pattern to your own repo if you
  run the bridge inside it:

  ```
  .gitlab-duo-review-*.txt
  ```
- **`raw`/`summary` mirror Duo's output.** That's intentional (so you can debug),
  but it means anything Duo prints — including auth errors — ends up there. Don't
  forward those fields somewhere public.

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
