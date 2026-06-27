/**
 * Thin, safe wrapper around the GitLab Duo CLI subprocess.
 *
 * - Uses `spawn` with an args array and `shell: false`, so the goal string is
 *   passed as a single argv entry (no shell injection, no quoting headaches).
 * - Captures stdout/stderr, enforces a timeout, and never throws: failures are
 *   reported in the resolved {@link RunResult} so the caller stays in control.
 */

import { spawn } from "node:child_process";

export interface RunOptions {
  command: string;
  baseArgs: string[];
  goalFlag: string;
  modelFlag: string;
  model?: string;
  extraArgs: string[];
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null if it never exited normally. */
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Set when the process could not be spawned/launched at all. */
  spawnError?: string;
  /** Human-readable command line (goal redacted) for diagnostics. */
  commandLine: string;
}

/** Build the argv passed to spawn. */
function buildArgs(goal: string, opts: RunOptions): string[] {
  const args = [...opts.baseArgs, opts.goalFlag, goal];
  if (opts.model) {
    args.push(opts.modelFlag, opts.model);
  }
  args.push(...opts.extraArgs);
  return args;
}

/** Quote an arg for display only (never used for actual execution). */
function quoteForDisplay(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

/** Build a display command line with the (potentially huge) goal redacted. */
function renderCommandLine(goal: string, opts: RunOptions): string {
  const display = [opts.command, ...opts.baseArgs, opts.goalFlag, "<goal>"];
  if (opts.model) display.push(opts.modelFlag, opts.model);
  display.push(...opts.extraArgs);
  return display.map(quoteForDisplay).join(" ");
}

export async function runDuo(goal: string, opts: RunOptions): Promise<RunResult> {
  const args = buildArgs(goal, opts);
  const commandLine = renderCommandLine(goal, opts);
  const start = Date.now();

  return new Promise<RunResult>((resolve) => {
    let settled = false;
    const finish = (result: Omit<RunResult, "durationMs" | "commandLine">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - start, commandLine });
    };

    let child;
    try {
      child = spawn(opts.command, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        commandLine,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Hard-kill if it does not exit promptly.
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2000).unref?.();
    }, opts.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      finish({
        stdout,
        stderr,
        exitCode: null,
        timedOut,
        spawnError: err instanceof Error ? err.message : String(err),
      });
    });

    child.on("close", (code) => {
      finish({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}
