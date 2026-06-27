import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPointerGoal, writeGoalFile } from "../src/goalFile.js";

test("buildPointerGoal references the file and asks Duo to read it", () => {
  const goal = buildPointerGoal(".gitlab-duo-review-abc.txt");
  assert.match(goal, /\.gitlab-duo-review-abc\.txt/);
  assert.match(goal, /read that file/i);
  assert.match(goal, /single JSON object/i);
});

test("writeGoalFile writes the goal and cleanup removes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "duo-goalfile-"));
  try {
    const content = "FULL GOAL\n" + "x".repeat(5000);
    const handle = writeGoalFile(content, dir);
    assert.ok(handle, "expected a handle");
    assert.ok(existsSync(handle!.filePath), "temp file should exist");
    assert.equal(readFileSync(handle!.filePath, "utf8"), content);
    assert.match(handle!.fileName, /^\.gitlab-duo-review-/);

    handle!.cleanup();
    assert.equal(existsSync(handle!.filePath), false, "cleanup should delete it");
    // cleanup is idempotent / never throws even if already gone.
    handle!.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeGoalFile returns null when the directory does not exist", () => {
  const missing = join(tmpdir(), "duo-does-not-exist-" + Date.now(), "nested");
  const handle = writeGoalFile("goal", missing);
  assert.equal(handle, null);
});

test("each writeGoalFile call uses a unique file name", () => {
  const dir = mkdtempSync(join(tmpdir(), "duo-goalfile-uniq-"));
  try {
    const a = writeGoalFile("a", dir);
    const b = writeGoalFile("b", dir);
    assert.ok(a && b);
    assert.notEqual(a!.fileName, b!.fileName);
    assert.equal(readdirSync(dir).length, 2);
    a!.cleanup();
    b!.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
