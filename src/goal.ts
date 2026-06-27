/**
 * Builds the goal/prompt string handed to the Duo CLI.
 *
 * When the caller provides a `diff`, file paths, and/or extra `instructions`,
 * they are embedded directly into the prompt so Duo reviews exactly what was
 * passed. When nothing concrete is provided, the bridge falls back to Duo's
 * agentic abilities: in headless mode it has its own tools (git, file reading,
 * ripgrep/grep) and auto-approves them, so we ask it to gather and review the
 * working-tree changes itself.
 *
 * Large prompts (e.g. a big embedded diff) are handled by the caller: above
 * `DUO_MAX_INLINE_GOAL_CHARS` the goal is written to a temp file and Duo is
 * asked to read it, avoiding OS command-line length limits (ENAMETOOLONG).
 *
 * The prompt asks Duo to answer with a single JSON object matching the schema
 * the normalizer expects. This is best-effort: Duo may still answer with prose,
 * which is why the normalizer is tolerant to failure.
 */

export interface ReviewInput {
  /** Unified diff to review (e.g. output of `git diff`). */
  diff?: string;
  /** Optional file paths to focus the review on (Duo opens them itself). */
  files?: string[];
  /** Extra free-form guidance for the reviewer. */
  instructions?: string;
  /** Override the entire goal/prompt; when set, the rest is ignored. */
  goal?: string;
  /** Working directory for this specific run. */
  cwd?: string;
  /** Model override for this specific run. */
  model?: string;
  /** Timeout override for this specific run, in ms. */
  timeoutMs?: number;
}

const SCHEMA_INSTRUCTION =
  "IMPORTANT: Respond with ONLY a single JSON object and nothing else " +
  "(no prose before or after, no markdown code fences). The JSON MUST match " +
  "exactly this schema:\n" +
  '{"summary": string, "issues": [{"type": string, ' +
  '"severity": "critical" | "high" | "medium" | "low" | "info", ' +
  '"file": string | null, "line": number | null, ' +
  '"message": string, "suggestion": string | null}]}';

export function buildReviewGoal(input: ReviewInput): string {
  if (input.goal && input.goal.trim() !== "") {
    return input.goal.trim();
  }

  const parts: string[] = [];

  const diff = input.diff?.trim() ?? "";
  const hasDiff = diff !== "";
  const files = input.files ?? [];
  const hasFiles = files.length > 0;

  if (hasDiff || hasFiles) {
    parts.push(
      "You are a senior software engineer performing a thorough code review.",
    );
  } else {
    parts.push(
      "You are a senior software engineer performing a thorough code review. " +
        "Use your own tools (git, file reading, ripgrep/grep) to gather the " +
        "code to review YOURSELF — no diff or file contents are included in " +
        "this prompt, so do not wait for any to be provided.",
    );
  }

  if (hasDiff) {
    parts.push(
      "Review the following unified diff:\n\n```diff\n" + diff + "\n```",
    );
  }

  if (hasFiles) {
    parts.push(
      "Review these files (open and read them yourself):\n- " +
        files.join("\n- "),
    );
  }

  if (!hasDiff && !hasFiles) {
    parts.push(
      "Review the current uncommitted changes in the working tree: run " +
        "`git diff` and `git status` yourself and read the changed files. If " +
        "there are no uncommitted changes, review the changes introduced by " +
        "the most recent commit instead.",
    );
  }

  parts.push(
    "Analyze the code for bugs, security vulnerabilities, architectural and " +
      "design problems, performance issues, and maintainability concerns.",
  );

  if (input.instructions && input.instructions.trim() !== "") {
    parts.push(`Additional instructions:\n${input.instructions.trim()}`);
  }

  parts.push(SCHEMA_INSTRUCTION);

  return parts.join("\n\n");
}
