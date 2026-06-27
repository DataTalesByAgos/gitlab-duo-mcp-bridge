/**
 * Configuration for the bridge, loaded from environment variables.
 *
 * Every value has a sensible default so the server can boot with no setup
 * (in MOCK mode) and be tuned entirely through env vars in the MCP client.
 */

export interface DuoConfig {
  /** Executable to launch, e.g. `glab` or `duo`. */
  command: string;
  /** Base sub-command args, e.g. ["duo", "cli", "run"]. */
  baseArgs: string[];
  /** Flag used to pass the goal/prompt, e.g. `--goal`. */
  goalFlag: string;
  /** Flag used to pass the model, e.g. `--model`. */
  modelFlag: string;
  /** Optional default model. */
  model?: string;
  /** Extra args appended to every invocation. */
  extraArgs: string[];
  /** Timeout for a single Duo run, in milliseconds. */
  timeoutMs: number;
  /** Working directory Duo runs in. */
  cwd?: string;
  /** Max characters of raw output retained in the structured result. */
  maxOutputChars: number;
  /**
   * Max length (in characters) of the goal/prompt passed inline as a single
   * argv entry. Above this, the goal is written to a temp file in the working
   * directory and Duo is asked to read it, to avoid OS command-line length
   * limits (e.g. ENAMETOOLONG on Windows with large diffs).
   */
  maxInlineGoalChars: number;
  /** When true, return a canned review instead of calling Duo. */
  mock: boolean;
  /** Name the tool is registered under. */
  toolName: string;
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Split a space-separated arg string. Empty/undefined falls back to `fallback`. */
function splitArgs(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed === "") return [];
  return trimmed.split(/\s+/);
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DuoConfig {
  return {
    command: trimmedOrUndefined(env.DUO_CLI_COMMAND) ?? "glab",
    baseArgs: splitArgs(env.DUO_CLI_BASE_ARGS, ["duo", "cli", "run"]),
    goalFlag: trimmedOrUndefined(env.DUO_CLI_GOAL_FLAG) ?? "--goal",
    modelFlag: trimmedOrUndefined(env.DUO_CLI_MODEL_FLAG) ?? "--model",
    model: trimmedOrUndefined(env.GITLAB_DUO_MODEL),
    extraArgs: splitArgs(env.DUO_CLI_EXTRA_ARGS, []),
    timeoutMs: parseIntOr(env.DUO_TIMEOUT_MS, 120_000),
    cwd: trimmedOrUndefined(env.DUO_CLI_CWD),
    maxOutputChars: parseIntOr(env.DUO_MAX_OUTPUT_CHARS, 100_000),
    maxInlineGoalChars: parseIntOr(env.DUO_MAX_INLINE_GOAL_CHARS, 7_000),
    mock: isTruthy(env.DUO_MOCK),
    toolName: trimmedOrUndefined(env.DUO_TOOL_NAME) ?? "duo_review",
  };
}
