import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReviewGoal } from "../src/goal.js";

test("uses the goal override verbatim when provided", () => {
  const goal = buildReviewGoal({ goal: "  Just do X  " });
  assert.equal(goal, "Just do X");
});

test("includes diff, files and instructions in the built goal", () => {
  const goal = buildReviewGoal({
    diff: "--- a\n+++ b\n+const x = 1;",
    files: ["src/a.ts", "src/b.ts"],
    instructions: "Focus on security.",
  });
  assert.match(goal, /Focus on security\./);
  assert.match(goal, /src\/a\.ts/);
  assert.match(goal, /src\/b\.ts/);
  assert.match(goal, /const x = 1;/);
  // Always asks for the JSON schema.
  assert.match(goal, /"severity": "critical" \| "high" \| "medium" \| "low" \| "info"/);
});

test("still produces a valid goal with no inputs", () => {
  const goal = buildReviewGoal({});
  assert.match(goal, /senior software engineer/i);
  assert.match(goal, /single JSON object/i);
});
