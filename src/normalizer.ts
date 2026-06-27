/**
 * Fault-tolerant normalizer for GitLab Duo CLI output.
 *
 * Duo's headless output is "agentic text": it MIGHT be the JSON we asked for,
 * but it can also be prose, JSON wrapped in markdown fences, JSON with trailing
 * commentary, an array of findings, or a completely free-form review. This
 * module turns any of those into a stable {@link NormalizedReview}, and when it
 * cannot find structured data it degrades gracefully to plain text instead of
 * throwing. Nothing here ever throws.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITIES: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export interface NormalizedIssue {
  type: string;
  severity: Severity;
  file: string | null;
  line: number | null;
  message: string;
  suggestion: string | null;
}

export interface NormalizedReview {
  /** True when we could NOT extract structured data and fell back to text. */
  degraded: boolean;
  summary: string;
  issues: NormalizedIssue[];
  /** Non-null when something went wrong while parsing. */
  parseError: string | null;
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  critical: "critical",
  blocker: "critical",
  fatal: "critical",
  severe: "critical",
  high: "high",
  major: "high",
  error: "high",
  important: "high",
  medium: "medium",
  moderate: "medium",
  warning: "medium",
  warn: "medium",
  normal: "medium",
  low: "low",
  minor: "low",
  trivial: "low",
  info: "info",
  informational: "info",
  note: "info",
  notice: "info",
  nit: "info",
  suggestion: "info",
  hint: "info",
  style: "info",
};

/** Coerce any severity-ish value into one of the canonical levels. */
export function normalizeSeverity(value: unknown): Severity {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 4) return "critical";
    if (value === 3) return "high";
    if (value === 2) return "medium";
    if (value === 1) return "low";
    return "info";
  }
  if (typeof value !== "string") return "info";
  const key = value.trim().toLowerCase();
  if (key === "") return "info";
  // Default unknown-but-present severities to "medium" so they are not hidden.
  return SEVERITY_ALIASES[key] ?? "medium";
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function firstArray(...values: unknown[]): unknown[] | null {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return null;
}

function firstLineNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

/** Convert a single issue-ish value (object or string) into a NormalizedIssue. */
function normalizeIssue(item: unknown): NormalizedIssue | null {
  if (typeof item === "string") {
    const message = item.trim();
    if (message === "") return null;
    return {
      type: "general",
      severity: "info",
      file: null,
      line: null,
      message,
      suggestion: null,
    };
  }

  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  const message = firstNonEmptyString(
    o.message,
    o.description,
    o.detail,
    o.details,
    o.text,
    o.body,
    o.title,
    o.issue,
    o.problem,
    o.comment,
  );
  const type =
    firstNonEmptyString(o.type, o.category, o.kind, o.rule, o.tag) ?? "general";
  const severity = normalizeSeverity(
    o.severity ?? o.priority ?? o.level ?? o.impact,
  );
  const file = firstNonEmptyString(
    o.file,
    o.path,
    o.filename,
    o.file_path,
    o.filePath,
    o.location,
  );
  const line = firstLineNumber(
    o.line,
    o.lineNumber,
    o.line_number,
    o.lineNo,
    o.row,
    o.start_line,
  );
  const suggestion = firstNonEmptyString(
    o.suggestion,
    o.fix,
    o.recommendation,
    o.remediation,
    o.solution,
    o.advice,
  );

  // Drop entries that carry no usable information at all.
  if (message === null && file === null && suggestion === null) return null;

  return {
    type,
    severity,
    file,
    line,
    message: message ?? (file ? `Issue in ${file}` : "Unspecified issue"),
    suggestion,
  };
}

/** Try to interpret a parsed JSON value as a review object. */
function coerceReviewObject(value: unknown): NormalizedReview | null {
  if (Array.isArray(value)) {
    const issues = value
      .map(normalizeIssue)
      .filter((x): x is NormalizedIssue => x !== null);
    if (issues.length === 0) return null;
    return {
      degraded: false,
      summary: `${issues.length} issue(s) found.`,
      issues,
      parseError: null,
    };
  }

  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;

  const issuesRaw = firstArray(
    o.issues,
    o.findings,
    o.problems,
    o.comments,
    o.results,
    o.violations,
  );
  const summary = firstNonEmptyString(o.summary, o.overview, o.conclusion);

  // Only accept this object if it actually looks like a review.
  if (issuesRaw === null && summary === null) return null;

  const issues = (issuesRaw ?? [])
    .map(normalizeIssue)
    .filter((x): x is NormalizedIssue => x !== null);

  return {
    degraded: false,
    summary:
      summary ??
      (issues.length > 0
        ? `${issues.length} issue(s) found.`
        : "No issues reported."),
    issues,
    parseError: null,
  };
}

/**
 * Extract balanced `{...}` or `[...]` substrings, respecting string literals so
 * braces inside strings do not break the matching.
 */
function extractBalanced(text: string, open: string, close: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === open) {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === close) {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          results.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return results;
}

/**
 * Produce JSON candidate strings from raw text, in priority order:
 * 1. the whole text (pure JSON),
 * 2. contents of ```json / ``` fenced blocks,
 * 3. balanced {...} objects, then [...] arrays.
 */
export function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (trimmed.length < 2) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  add(text);

  const fenceRe = /```(?:json5?|jsonc)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    add(match[1]);
  }

  for (const obj of extractBalanced(text, "{", "}")) add(obj);
  for (const arr of extractBalanced(text, "[", "]")) add(arr);

  return candidates;
}

const MAX_SUMMARY_CHARS = 4000;

function clampSummary(text: string): string {
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  return `${text.slice(0, MAX_SUMMARY_CHARS)}\n... [truncated]`;
}

/**
 * Normalize raw Duo output into a stable review structure. Never throws.
 */
export function normalizeReview(raw: string): NormalizedReview {
  const text = (raw ?? "").trim();
  if (text === "") {
    return {
      degraded: true,
      summary: "",
      issues: [],
      parseError: "Empty output from Duo CLI.",
    };
  }

  let lastError: string | null = null;
  for (const candidate of extractJsonCandidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }
    const review = coerceReviewObject(parsed);
    if (review) return review;
  }

  // Nothing structured found: degrade to plain text, but keep everything.
  return {
    degraded: true,
    summary: clampSummary(text),
    issues: [],
    parseError:
      lastError ??
      "No structured JSON found in Duo output; returning raw text.",
  };
}
