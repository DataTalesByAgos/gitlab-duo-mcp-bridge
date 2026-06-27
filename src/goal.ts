/**
 * Builds the goal/prompt string handed to the Duo CLI.
 *
 * The bridge deliberately does NOT paste diffs or file contents into the
 * prompt. GitLab Duo is agentic: in headless mode it has its own tools (git,
 * file reading, ripgrep/grep) and auto-approves them, so we simply ask it to
 * gather and review the changes itself. This keeps the calling agent cheap
 * (it sends no code), keeps the prompt tiny (no command-line length limits),
 * and means the heavy lifting runs on GitLab's side.
 *
 * The prompt asks Duo to answer with a single JSON object matching the schema
 * the normalizer expects. This is best-effort: Duo may still answer with prose,
 * which is why the normalizer is tolerant to failure.
 */

export interface ReviewInput {
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

  parts.push(
    "You are a senior software engineer performing a thorough code review. " +
      "Use your own tools (git, file reading, ripgrep/grep) to gather the code " +
      "to review YOURSELF — no diff or file contents are included in this " +
      "prompt, so do not wait for any to be provided.",
  );

  if (input.files && input.files.length > 0) {
    parts.push(
      "Review these files (open and read them yourself):\n- " +
        input.files.join("\n- "),
    );
  } else {
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
