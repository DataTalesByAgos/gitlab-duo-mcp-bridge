/**
 * MCP server wiring: registers the `duo_review` tool and orchestrates
 * goal building -> Duo CLI execution -> fault-tolerant normalization.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DuoConfig } from "./config.js";
import { buildReviewGoal, type ReviewInput } from "./goal.js";
import { runDuo, type RunResult } from "./duoRunner.js";
import {
  buildPointerGoal,
  writeGoalFile,
  type GoalFileHandle,
} from "./goalFile.js";
import {
  normalizeReview,
  SEVERITIES,
  type NormalizedReview,
} from "./normalizer.js";

export const SERVER_NAME = "gitlab-duo-mcp-bridge";
export const SERVER_VERSION = "0.1.0";

const TOOL_DESCRIPTION =
  "Run a code review with the GitLab Duo CLI and return a normalized, " +
  "fault-tolerant result. Use this to get a 'second opinion' review of a diff " +
  "or set of files: pass a unified `diff` (and/or `files`/`instructions`), and " +
  "you get back a stable JSON structure with a `summary` and a list of " +
  "`issues` (type, severity, file, line, message, suggestion). If Duo answers " +
  "with prose instead of JSON, the result is still returned with " +
  "`degraded: true` and the raw text in `summary`/`raw`. Your agent can then " +
  "act on the issues (e.g. write fixes).";

/**
 * The shape returned as `structuredContent`.
 *
 * Declared as a `type` (not an `interface`) so it satisfies the SDK's
 * `{ [x: string]: unknown }` index-signature requirement for structured content.
 */
export type ReviewStructuredResult = {
  ok: boolean;
  degraded: boolean;
  summary: string;
  issues: NormalizedReview["issues"];
  raw: string;
  meta: {
    commandLine: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    mock: boolean;
    parseError: string | null;
    /** True when the goal was too large and was passed via a temp file. */
    goalViaFile: boolean;
  };
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... [truncated ${text.length - max} chars]`;
}

/** A canned Duo run for MOCK mode (no real CLI call). */
function mockRun(config: DuoConfig): RunResult {
  const payload = {
    summary: "Mock review: 2 issues found in the provided changes.",
    issues: [
      {
        type: "security",
        severity: "high",
        file: "src/auth.ts",
        line: 42,
        message: "User input is concatenated directly into a SQL query.",
        suggestion: "Use parameterized queries / prepared statements.",
      },
      {
        type: "maintainability",
        severity: "low",
        file: "src/utils.ts",
        line: null,
        message: "Function does too many things and is hard to test.",
        suggestion: "Split it into smaller, single-responsibility helpers.",
      },
    ],
  };
  const stdout = ["Here is my review:", "```json", JSON.stringify(payload, null, 2), "```"].join("\n");
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    commandLine: `[MOCK] ${config.command} ${config.baseArgs.join(" ")} ${config.goalFlag} <goal>`,
  };
}

/** Build a short, human-readable text rendering of the structured result. */
function renderText(result: ReviewStructuredResult): string {
  const lines: string[] = [];

  if (result.degraded) {
    lines.push(
      "WARNING: Duo output could not be parsed as structured JSON; returning a best-effort result.",
    );
  } else {
    lines.push(`Duo review complete: ${result.issues.length} issue(s) found.`);
  }

  if (result.summary) {
    lines.push("");
    lines.push(result.summary);
  }

  if (result.issues.length > 0) {
    lines.push("");
    for (const issue of result.issues) {
      const loc = issue.file
        ? ` (${issue.file}${issue.line != null ? `:${issue.line}` : ""})`
        : "";
      lines.push(`- [${issue.severity}] ${issue.type}${loc}: ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`    -> ${issue.suggestion}`);
      }
    }
  }

  if (!result.ok) {
    lines.push("");
    const bits = [
      `exitCode=${result.meta.exitCode}`,
      `timedOut=${result.meta.timedOut}`,
    ];
    if (result.meta.parseError) bits.push(`parseError=${result.meta.parseError}`);
    lines.push(`(${bits.join(", ")})`);
  }

  return lines.join("\n");
}

/** Core handler: run Duo (or mock) and normalize the result. */
export async function handleReview(
  config: DuoConfig,
  input: ReviewInput,
): Promise<{
  content: { type: "text"; text: string }[];
  structuredContent: ReviewStructuredResult;
  isError?: boolean;
}> {
  const goal = buildReviewGoal(input);
  const effectiveCwd = input.cwd ?? config.cwd ?? process.cwd();

  // Very large goals (e.g. big diffs) can blow past the OS command-line length
  // limit (ENAMETOOLONG on Windows). When that happens, write the goal to a
  // temp file in the working directory and pass a tiny pointer goal instead;
  // Duo reads the file itself (it is agentic and auto-approves tools headless).
  let goalFile: GoalFileHandle | null = null;
  let goalToSend = goal;
  if (!config.mock && goal.length > config.maxInlineGoalChars) {
    goalFile = writeGoalFile(goal, effectiveCwd);
    if (goalFile) {
      goalToSend = buildPointerGoal(goalFile.fileName);
    }
  }
  const goalViaFile = goalFile !== null;

  let run: RunResult;
  try {
    run = config.mock
      ? mockRun(config)
      : await runDuo(goalToSend, {
          command: config.command,
          baseArgs: config.baseArgs,
          goalFlag: config.goalFlag,
          modelFlag: config.modelFlag,
          model: input.model ?? config.model,
          extraArgs: config.extraArgs,
          timeoutMs: input.timeoutMs ?? config.timeoutMs,
          cwd: effectiveCwd,
        });
  } finally {
    // Always remove the temp file, even on failure/timeout.
    goalFile?.cleanup();
  }

  // Hard launch failure (e.g. command not found): surface an actionable error.
  if (run.spawnError) {
    const tooLong = /ENAMETOOLONG|E2BIG|too long/i.test(run.spawnError);
    const message =
      `Failed to launch the Duo CLI ('${config.command}'): ${run.spawnError}. ` +
      (tooLong
        ? "This usually means the prompt/diff was too large for the command " +
          "line. The bridge writes oversized goals to a temp file above " +
          `DUO_MAX_INLINE_GOAL_CHARS (currently ${config.maxInlineGoalChars}); ` +
          "lower that value, or pass fewer/smaller inputs (e.g. specific " +
          "`files` instead of a huge `diff`). "
        : "") +
      "Check DUO_CLI_COMMAND / DUO_CLI_BASE_ARGS, make sure the CLI is " +
      "installed and on PATH, or set DUO_MOCK=1 to test the bridge without Duo.";
    const structured: ReviewStructuredResult = {
      ok: false,
      degraded: true,
      summary: message,
      issues: [],
      raw: truncate(run.stderr, config.maxOutputChars),
      meta: {
        commandLine: run.commandLine,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
        mock: config.mock,
        parseError: run.spawnError,
        goalViaFile,
      },
    };
    return {
      content: [{ type: "text", text: message }],
      structuredContent: structured,
      isError: true,
    };
  }

  const source = run.stdout.trim() !== "" ? run.stdout : run.stderr;
  const normalized = normalizeReview(source);
  const ok = run.exitCode === 0 && !run.timedOut;

  const structured: ReviewStructuredResult = {
    ok,
    degraded: normalized.degraded,
    summary: normalized.summary,
    issues: normalized.issues,
    raw: truncate(run.stdout || run.stderr, config.maxOutputChars),
    meta: {
      commandLine: run.commandLine,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      durationMs: run.durationMs,
      mock: config.mock,
      parseError: normalized.parseError,
      goalViaFile,
    },
  };

  // Only flag a true error when the run failed AND produced nothing usable.
  const isError = !ok && normalized.degraded && normalized.issues.length === 0;

  return {
    content: [{ type: "text", text: renderText(structured) }],
    structuredContent: structured,
    isError,
  };
}

export function createServer(config: DuoConfig): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const inputSchema = {
    diff: z
      .string()
      .optional()
      .describe("Unified diff to review (e.g. output of `git diff`)."),
    files: z
      .array(z.string())
      .optional()
      .describe("File paths to focus the review on."),
    instructions: z
      .string()
      .optional()
      .describe("Extra free-form guidance for the reviewer."),
    goal: z
      .string()
      .optional()
      .describe(
        "Override the entire prompt sent to Duo. When set, diff/files/instructions are ignored.",
      ),
    cwd: z
      .string()
      .optional()
      .describe("Working directory to run Duo in for this call."),
    model: z.string().optional().describe("Override the Duo model for this call."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Override the run timeout (milliseconds) for this call."),
  };

  const outputSchema = {
    ok: z
      .boolean()
      .describe("True when Duo exited successfully and did not time out."),
    degraded: z
      .boolean()
      .describe("True when output could not be parsed as JSON (raw text fallback)."),
    summary: z.string().describe("Review summary, or raw text when degraded."),
    issues: z
      .array(
        z.object({
          type: z.string(),
          severity: z.enum(SEVERITIES as unknown as [string, ...string[]]),
          file: z.string().nullable(),
          line: z.number().nullable(),
          message: z.string(),
          suggestion: z.string().nullable(),
        }),
      )
      .describe("Normalized list of findings."),
    raw: z.string().describe("Raw (truncated) Duo output for debugging."),
    meta: z.object({
      commandLine: z.string(),
      exitCode: z.number().nullable(),
      timedOut: z.boolean(),
      durationMs: z.number(),
      mock: z.boolean(),
      parseError: z.string().nullable(),
      goalViaFile: z.boolean(),
    }),
  };

  server.registerTool(
    config.toolName,
    {
      title: "GitLab Duo Review",
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
    },
    async (input) => handleReview(config, input as ReviewInput),
  );

  return server;
}
