/**
 * Large-goal fallback.
 *
 * Passing a huge prompt (e.g. a 30KB diff) as a single `--goal` argv entry can
 * exceed the OS command-line length limit (ENAMETOOLONG on Windows, E2BIG on
 * Linux). To stay robust, when the goal is too large we write it to a temporary
 * file in the working directory Duo runs in, and instead pass a tiny "pointer"
 * goal that asks Duo (which is agentic and reads files autonomously in headless
 * mode) to read that file and follow its instructions.
 *
 * Everything here is best-effort and never throws: if the file cannot be
 * written, the caller falls back to passing the goal inline.
 */

import { randomBytes } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GoalFileHandle {
  /** Bare file name (relative to the working directory). */
  fileName: string;
  /** Absolute path on disk. */
  filePath: string;
  /** Remove the temp file. Best-effort; never throws. */
  cleanup: () => void;
}

/**
 * Build the short prompt that points Duo at the externalized goal file.
 * Kept well under any command-line limit on purpose.
 */
export function buildPointerGoal(fileName: string): string {
  return (
    "Your full task instructions, including the unified diff to review, were " +
    "too large to pass on the command line, so they have been written to a " +
    `file in your current working directory named "${fileName}". ` +
    "First, read that file in full using your file-reading tools. Then carry " +
    "out the instructions it contains exactly, including responding with ONLY " +
    "the single JSON object that the file describes (no prose, no code fences)."
  );
}

/**
 * Write `goal` to a uniquely named temp file inside `cwd`. Returns a handle
 * (with a `cleanup` to delete it) or `null` if writing failed.
 */
export function writeGoalFile(goal: string, cwd: string): GoalFileHandle | null {
  try {
    const fileName = `.gitlab-duo-review-${Date.now()}-${randomBytes(4).toString(
      "hex",
    )}.txt`;
    const filePath = join(cwd, fileName);
    writeFileSync(filePath, goal, "utf8");
    return {
      fileName,
      filePath,
      cleanup: () => {
        try {
          unlinkSync(filePath);
        } catch {
          /* best-effort: file may already be gone */
        }
      },
    };
  } catch {
    return null;
  }
}
