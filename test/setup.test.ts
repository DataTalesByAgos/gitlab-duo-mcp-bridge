import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { runSetup } from "../src/setup.js";

test("runSetup configures globally only selected clients", async () => {
  // Save original methods
  const originalAccess = fs.access;
  const originalReadFile = fs.readFile;
  const originalWriteFile = fs.writeFile;
  const originalMkdir = fs.mkdir;
  const originalCreateInterface = readline.createInterface;

  const accessedPaths: string[] = [];
  const writtenPaths: string[] = [];
  const writtenContents: Record<string, string> = {};

  // Mock fs operations
  fs.access = async (path: any) => {
    const pathStr = String(path);
    accessedPaths.push(pathStr);
    // Pretend .cursor and zed configurations exist (by matching their parent directories)
    if (pathStr.endsWith(".cursor") || pathStr.endsWith("zed")) {
      return;
    }
    throw new Error("ENOENT");
  };

  (fs as any).readFile = async () => {
    return JSON.stringify({});
  };

  fs.writeFile = async (path: any, data: any) => {
    const pathStr = String(path);
    writtenPaths.push(pathStr);
    writtenContents[pathStr] = String(data);
  };

  fs.mkdir = async () => {
    return undefined;
  };

  const questionsAsked: string[] = [];
  let answerIndex = 0;
  // Answer "1" (Global), then "n" (configure all?), "y" to Cursor, "n" to Zed
  const mockAnswers = ["1", "n", "y", "n"];

  (readline as any).createInterface = () => {
    return {
      question: async (query: string) => {
        questionsAsked.push(query);
        return mockAnswers[answerIndex++] || "n";
      },
      close: () => {},
    };
  };

  try {
    await runSetup();

    // Verify correct questions were asked
    assert.ok(questionsAsked.length >= 3, "Should have asked multiple questions");
    assert.ok(questionsAsked[0]?.includes("Enter choice"), "Should ask where to configure");
    assert.ok(questionsAsked[1]?.includes("all detected clients"), "Should ask whether to configure all");
    assert.ok(questionsAsked.some(q => q.includes("Configure Cursor")), "Should ask about Cursor specifically");

    // Verify only Cursor was configured (since we chose 'y' for Cursor and 'n' for Zed)
    assert.ok(writtenPaths.some(p => p.includes("mcp.json")), "Cursor config should be written");
    assert.ok(!writtenPaths.some(p => p.includes("zed")), "Zed config should not be written");
  } finally {
    // Restore originals
    fs.access = originalAccess;
    fs.readFile = originalReadFile;
    fs.writeFile = originalWriteFile;
    fs.mkdir = originalMkdir;
    (readline as any).createInterface = originalCreateInterface;
  }
});

test("runSetup configures locally in project directory", async () => {
  // Save original methods
  const originalAccess = fs.access;
  const originalReadFile = fs.readFile;
  const originalWriteFile = fs.writeFile;
  const originalMkdir = fs.mkdir;
  const originalCreateInterface = readline.createInterface;

  const writtenPaths: string[] = [];
  const writtenContents: Record<string, string> = {};

  (fs as any).readFile = async () => {
    // Pretend there's no existing local mcp.json
    throw { code: "ENOENT" };
  };

  fs.writeFile = async (path: any, data: any) => {
    const pathStr = String(path);
    writtenPaths.push(pathStr);
    writtenContents[pathStr] = String(data);
  };

  fs.mkdir = async () => {
    return undefined;
  };

  const questionsAsked: string[] = [];
  let answerIndex = 0;
  // Answer "2" (Locally)
  const mockAnswers = ["2"];

  (readline as any).createInterface = () => {
    return {
      question: async (query: string) => {
        questionsAsked.push(query);
        return mockAnswers[answerIndex++] || "2";
      },
      close: () => {},
    };
  };

  try {
    await runSetup();

    // Verify correct questions were asked
    assert.equal(questionsAsked.length, 1);
    assert.ok(questionsAsked[0]?.includes("Enter choice"), "Should ask where to configure");

    // Verify local mcp.json was written
    assert.ok(writtenPaths.length > 0, "Local config should be written");
    const writtenPath = writtenPaths[0] as string;
    assert.ok(writtenPath.endsWith("mcp.json"), "Written file must be mcp.json");
    
    // Verify the written content structure
    const parsed = JSON.parse(writtenContents[writtenPath] as string);
    assert.ok(parsed.mcpServers["gitlab-duo"], "Should contain gitlab-duo in mcpServers");
  } finally {
    // Restore originals
    fs.access = originalAccess;
    fs.readFile = originalReadFile;
    fs.writeFile = originalWriteFile;
    fs.mkdir = originalMkdir;
    (readline as any).createInterface = originalCreateInterface;
  }
});
