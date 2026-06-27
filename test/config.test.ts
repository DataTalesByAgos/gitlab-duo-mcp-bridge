import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModel, loadConfig } from "../src/config.js";

test("resolveModel maps friendly names to GitLab identifiers", () => {
  assert.equal(resolveModel("sonnet"), "claude_sonnet_4_6");
  assert.equal(resolveModel("haiku"), "claude_haiku_4_5_20251001");
  assert.equal(resolveModel("opus"), "claude_opus_4_5_20251101");
  assert.equal(resolveModel("gpt5"), "gpt_5");
  assert.equal(resolveModel("gpt5-mini"), "gpt_5_mini");
  assert.equal(resolveModel("gpt5-codex"), "gpt_5_codex");
  assert.equal(resolveModel("gemini"), "gemini_2_5_flash_vertex");
  
  // Case insensitivity
  assert.equal(resolveModel("SoNnEt"), "claude_sonnet_4_6");
  
  // Trimming
  assert.equal(resolveModel("  gemini  "), "gemini_2_5_flash_vertex");
  
  // Unknown or complex fallback
  assert.equal(resolveModel("custom_model_identifier"), "custom_model_identifier");
  assert.equal(resolveModel(undefined), undefined);
});

test("loadConfig resolves model from environment variables", () => {
  const config = loadConfig({ GITLAB_DUO_MODEL: "sonnet" });
  assert.equal(config.model, "claude_sonnet_4_6");
});
