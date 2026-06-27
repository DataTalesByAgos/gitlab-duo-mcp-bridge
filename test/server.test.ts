import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DuoConfig } from "../src/config.js";
import { handleReview } from "../src/server.js";

function makeConfig(overrides: Partial<DuoConfig> = {}): DuoConfig {
  return {
    command: "glab",
    baseArgs: ["duo", "cli", "run"],
    goalFlag: "--goal",
    modelFlag: "--model",
    model: undefined,
    extraArgs: [],
    timeoutMs: 5_000,
    cwd: undefined,
    maxOutputChars: 100_000,
    maxInlineGoalChars: 7_000,
    mock: false,
    toolName: "duo_review",
    ...overrides,
  };
}

test("MOCK mode never externalizes, even with a huge diff", async () => {
  const config = makeConfig({ mock: true, maxInlineGoalChars: 50 });
  const result = await handleReview(config, { diff: "x".repeat(50_000) });
  assert.equal(result.structuredContent.meta.mock, true);
  assert.equal(result.structuredContent.meta.goalViaFile, false);
  assert.equal(result.structuredContent.degraded, false);
  assert.ok(result.structuredContent.issues.length > 0);
});

test("large diff is written to a temp file and cleaned up (no ENAMETOOLONG)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duo-server-"));
  try {
    // A command that does not exist: spawn fails, but we still exercise the
    // externalization + cleanup path. No real Duo needed.
    const config = makeConfig({
      command: "__no_such_duo_cli__",
      baseArgs: ["run"],
      maxInlineGoalChars: 100,
    });
    const result = await handleReview(config, {
      diff: "diff --git a/x b/x\n" + "+".repeat(20_000),
      cwd: dir,
    });

    // It chose the temp-file path and reported a clean (non-crashing) error.
    assert.equal(result.structuredContent.meta.goalViaFile, true);
    assert.equal(result.isError, true);

    // The temp goal file must be gone after the call.
    const leftovers = readdirSync(dir).filter((n) =>
      n.startsWith(".gitlab-duo-review-"),
    );
    assert.deepEqual(leftovers, [], "temp goal file should be cleaned up");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("small diff stays inline (no temp file)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duo-server-inline-"));
  try {
    const config = makeConfig({
      command: "__no_such_duo_cli__",
      baseArgs: ["run"],
      maxInlineGoalChars: 1_000_000,
    });
    const result = await handleReview(config, { diff: "small change", cwd: dir });
    assert.equal(result.structuredContent.meta.goalViaFile, false);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
