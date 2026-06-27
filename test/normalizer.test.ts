import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeReview,
  normalizeSeverity,
  extractJsonCandidates,
} from "../src/normalizer.js";

test("parses pure JSON output", () => {
  const raw = JSON.stringify({
    summary: "Looks good overall.",
    issues: [
      {
        type: "bug",
        severity: "high",
        file: "a.ts",
        line: 10,
        message: "Off by one",
        suggestion: "Use <=",
      },
    ],
  });
  const result = normalizeReview(raw);
  assert.equal(result.degraded, false);
  assert.equal(result.summary, "Looks good overall.");
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0], {
    type: "bug",
    severity: "high",
    file: "a.ts",
    line: 10,
    message: "Off by one",
    suggestion: "Use <=",
  });
});

test("extracts JSON from a markdown fenced block surrounded by prose", () => {
  const raw = [
    "Sure! Here is the review you asked for:",
    "",
    "```json",
    '{"summary": "One issue.", "issues": [{"message": "Missing null check", "severity": "medium", "file": "b.ts"}]}',
    "```",
    "",
    "Let me know if you want me to fix it.",
  ].join("\n");
  const result = normalizeReview(raw);
  assert.equal(result.degraded, false);
  assert.equal(result.summary, "One issue.");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.severity, "medium");
  assert.equal(result.issues[0]?.file, "b.ts");
  assert.equal(result.issues[0]?.line, null);
});

test("extracts a balanced object with trailing commentary", () => {
  const raw =
    '{"issues": [{"message": "Use const", "severity": "low"}]} -- that is all I found.';
  const result = normalizeReview(raw);
  assert.equal(result.degraded, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.severity, "low");
});

test("handles a top-level JSON array of findings", () => {
  const raw =
    '[{"description": "SQL injection", "priority": "blocker", "path": "db.ts", "line": "7"}]';
  const result = normalizeReview(raw);
  assert.equal(result.degraded, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.severity, "critical");
  assert.equal(result.issues[0]?.file, "db.ts");
  assert.equal(result.issues[0]?.line, 7);
  assert.equal(result.issues[0]?.message, "SQL injection");
});

test("maps alternative field names and severity synonyms", () => {
  const raw = JSON.stringify({
    overview: "Some findings",
    findings: [
      {
        category: "style",
        level: "nit",
        filename: "c.ts",
        lineNumber: 3,
        detail: "Prefer single quotes",
        fix: "Change to single quotes",
      },
    ],
  });
  const result = normalizeReview(raw);
  assert.equal(result.degraded, false);
  assert.equal(result.summary, "Some findings");
  const issue = result.issues[0];
  assert.ok(issue);
  assert.equal(issue.type, "style");
  assert.equal(issue.severity, "info");
  assert.equal(issue.file, "c.ts");
  assert.equal(issue.line, 3);
  assert.equal(issue.message, "Prefer single quotes");
  assert.equal(issue.suggestion, "Change to single quotes");
});

test("falls back to plain text when there is no JSON", () => {
  const raw = "The code looks fine, I have no major concerns.";
  const result = normalizeReview(raw);
  assert.equal(result.degraded, true);
  assert.equal(result.summary, raw);
  assert.equal(result.issues.length, 0);
  assert.ok(result.parseError);
});

test("returns a degraded result for empty output", () => {
  const result = normalizeReview("   \n  ");
  assert.equal(result.degraded, true);
  assert.equal(result.summary, "");
  assert.equal(result.issues.length, 0);
  assert.ok(result.parseError);
});

test("ignores braces inside string values when extracting", () => {
  const raw =
    '{"summary": "Watch the {curly} braces } in strings", "issues": []}';
  const result = normalizeReview(raw);
  assert.equal(result.degraded, false);
  assert.equal(result.summary, "Watch the {curly} braces } in strings");
  assert.equal(result.issues.length, 0);
});

test("normalizeSeverity coerces numbers and unknowns", () => {
  assert.equal(normalizeSeverity(4), "critical");
  assert.equal(normalizeSeverity(3), "high");
  assert.equal(normalizeSeverity(2), "medium");
  assert.equal(normalizeSeverity(1), "low");
  assert.equal(normalizeSeverity(0), "info");
  assert.equal(normalizeSeverity("MAJOR"), "high");
  assert.equal(normalizeSeverity("totally-unknown"), "medium");
  assert.equal(normalizeSeverity(undefined), "info");
});

test("extractJsonCandidates prioritizes the whole string first", () => {
  const candidates = extractJsonCandidates('{"a":1}');
  assert.equal(candidates[0], '{"a":1}');
});
