import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
  context_servers?: Record<string, McpServerConfig>;
  [key: string]: any;
}

export async function runSetup(): Promise<void> {
  const home = os.homedir();
  const platform = os.platform();

  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";

  // Define client configurations and their paths
  const targets: { name: string; path: string; key: "mcpServers" | "context_servers" | "raw" }[] = [];

  const newConfigEntry: McpServerConfig = {
    command: "npx",
    args: ["-y", "gitlab-duo-mcp-bridge"],
  };

  if (platform === "win32") {
    // Claude Desktop (Standard)
    if (appData) {
      targets.push({
        name: "Claude Desktop (Standard)",
        path: path.join(appData, "Claude", "claude_desktop_config.json"),
        key: "mcpServers",
      });
    }
    // Claude Desktop (MSIX)
    if (localAppData) {
      targets.push({
        name: "Claude Desktop (MSIX)",
        path: path.join(
          localAppData,
          "Packages",
          "Claude_pzs8sxrjxfjjc",
          "LocalCache",
          "Roaming",
          "Claude",
          "claude_desktop_config.json"
        ),
        key: "mcpServers",
      });
    }
    // Cursor
    targets.push({
      name: "Cursor",
      path: path.join(home, ".cursor", "mcp.json"),
      key: "mcpServers",
    });
    // Cline
    if (appData) {
      targets.push({
        name: "Cline (VS Code)",
        path: path.join(
          appData,
          "Code",
          "User",
          "globalStorage",
          "saoudrizwan.claude-dev",
          "settings",
          "cline_mcp_settings.json"
        ),
        key: "mcpServers",
      });
    }
    // Roo Code
    if (appData) {
      targets.push({
        name: "Roo Code (VS Code)",
        path: path.join(
          appData,
          "Code",
          "User",
          "globalStorage",
          "rooveterinaryinc.roo-cline",
          "settings",
          "cline_mcp_settings.json"
        ),
        key: "mcpServers",
      });
    }
    // Windsurf
    if (appData) {
      targets.push({
        name: "Windsurf",
        path: path.join(appData, "Windsurf", "mcp_settings.json"),
        key: "mcpServers",
      });
    }
  } else if (platform === "darwin") {
    // Claude Desktop
    targets.push({
      name: "Claude Desktop",
      path: path.join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json"
      ),
      key: "mcpServers",
    });
    // Cursor
    targets.push({
      name: "Cursor",
      path: path.join(home, ".cursor", "mcp.json"),
      key: "mcpServers",
    });
    // Cline
    targets.push({
      name: "Cline (VS Code)",
      path: path.join(
        home,
        "Library",
        "Application Support",
        "Code",
        "User",
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json"
      ),
      key: "mcpServers",
    });
    // Roo Code
    targets.push({
      name: "Roo Code (VS Code)",
      path: path.join(
        home,
        "Library",
        "Application Support",
        "Code",
        "User",
        "globalStorage",
        "rooveterinaryinc.roo-cline",
        "settings",
        "cline_mcp_settings.json"
      ),
      key: "mcpServers",
    });
    // Windsurf
    targets.push({
      name: "Windsurf",
      path: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
      key: "mcpServers",
    });
    // Zed
    targets.push({
      name: "Zed",
      path: path.join(home, ".config", "zed", "settings.json"),
      key: "context_servers",
    });
  } else {
    // Linux and others
    // Claude Desktop
    targets.push({
      name: "Claude Desktop",
      path: path.join(home, ".config", "Claude", "claude_desktop_config.json"),
      key: "mcpServers",
    });
    // Cursor
    targets.push({
      name: "Cursor",
      path: path.join(home, ".cursor", "mcp.json"),
      key: "mcpServers",
    });
    // Cline
    targets.push({
      name: "Cline (VS Code)",
      path: path.join(
        home,
        ".config",
        "Code",
        "User",
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json"
      ),
      key: "mcpServers",
    });
    // Roo Code
    targets.push({
      name: "Roo Code (VS Code)",
      path: path.join(
        home,
        ".config",
        "Code",
        "User",
        "globalStorage",
        "rooveterinaryinc.roo-cline",
        "settings",
        "cline_mcp_settings.json"
      ),
      key: "mcpServers",
    });
    // Windsurf
    targets.push({
      name: "Windsurf",
      path: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
      key: "mcpServers",
    });
    // Zed
    targets.push({
      name: "Zed",
      path: path.join(home, ".config", "zed", "settings.json"),
      key: "context_servers",
    });
  }

  // Continue-specific path (Always uses a dedicated JSON file under ~/.continue/mcpServers/)
  targets.push({
    name: "Continue (IDE)",
    path: path.join(home, ".continue", "mcpServers", "gitlab-duo.json"),
    key: "raw",
  });

  process.stderr.write("Starting setup of gitlab-duo-mcp-bridge...\n\n");

  const rl = readline.createInterface({ input, output });

  process.stderr.write("Where would you like to configure gitlab-duo-mcp-bridge?\n");
  process.stderr.write("  1. Globally (system-wide for detected IDEs & MCP clients)\n");
  process.stderr.write("  2. Locally (in the current project directory)\n\n");

  let choice = "1";
  try {
    const choiceAnswer = await rl.question("Enter choice (1 or 2) [1]: ");
    if (choiceAnswer.trim() === "2" || choiceAnswer.trim().toLowerCase() === "locally") {
      choice = "2";
    }
  } catch (err) {
    // Gracefully fallback to choice "1" on any error
  }

  if (choice === "2") {
    rl.close();
    process.stderr.write("\nConfiguring locally in the current project directory...\n\n");
    const localPath = path.join(process.cwd(), "mcp.json");
    try {
      let config: McpConfig = {};
      try {
        const content = await fs.readFile(localPath, "utf8");
        if (content.trim() !== "") {
          config = JSON.parse(content);
        }
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          process.stderr.write(`⚠️ Could not read or parse existing mcp.json at ${localPath}: ${err.message}\n`);
        }
      }

      if (!config.mcpServers) {
        config.mcpServers = {};
      }
      config.mcpServers["gitlab-duo"] = newConfigEntry;

      await fs.writeFile(localPath, JSON.stringify(config, null, 2), "utf8");
      process.stderr.write(`✅ Successfully configured locally: mcp.json\n   └─ Path: ${localPath}\n\n`);
      process.stderr.write("🎉 Configuration complete!\n");
      process.stderr.write("Remember to restart or reload your AI client/agent to detect the 'duo_review' tool.\n");
      await checkGitLabConnection();
      printMiniGuide();
    } catch (err: any) {
      process.stderr.write(`❌ Error configuring locally at ${localPath}: ${err.message}\n`);
    }
    return;
  }

  process.stderr.write("\nScanning for active MCP client configuration directories...\n\n");

  const detectedTargets: { name: string; path: string; key: "mcpServers" | "context_servers" | "raw" }[] = [];

  for (const target of targets) {
    const parentDir = path.dirname(target.path);
    try {
      await fs.access(parentDir);
      detectedTargets.push(target);
    } catch {
      // Parent directory does not exist, so client is likely not installed or used. Skip it.
    }
  }

  if (detectedTargets.length === 0) {
    rl.close();
    process.stderr.write("⚠️ No active MCP client configuration directories were found.\n");
    process.stderr.write("If you use Claude Desktop, Cursor, Cline, Roo Code, Windsurf, Zed, or Continue, please make sure they are installed and have been opened at least once.\n");
    return;
  }

  process.stderr.write("We detected the following MCP client(s):\n");
  detectedTargets.forEach((target, index) => {
    process.stderr.write(`  ${index + 1}. ${target.name}\n`);
  });
  process.stderr.write("\n");

  let selectedTargets = detectedTargets;

  try {
    const answer = await rl.question("Do you want to configure all detected clients? (Y/n): ");
    const parsedAnswer = answer.trim().toLowerCase();

    if (parsedAnswer !== "" && parsedAnswer !== "y" && parsedAnswer !== "yes") {
      selectedTargets = [];
      for (const target of detectedTargets) {
        const individualAnswer = await rl.question(`Configure ${target.name}? (y/N): `);
        if (individualAnswer.trim().toLowerCase().startsWith("y")) {
          selectedTargets.push(target);
        }
      }
    }
  } finally {
    rl.close();
  }

  if (selectedTargets.length === 0) {
    process.stderr.write("\n⚠️ No clients were selected for configuration.\n");
    return;
  }

  process.stderr.write("\n");
  let configuredCount = 0;

  for (const target of selectedTargets) {
    const parentDir = path.dirname(target.path);

    try {
      let config: McpConfig = {};

      if (target.key === "raw") {
        // For dedicated JSON files (like Continue's config files under ~/.continue/mcpServers/)
        // We write the standard structure directly.
        config = {
          mcpServers: {
            "gitlab-duo": newConfigEntry,
          },
        };
      } else {
        try {
          const content = await fs.readFile(target.path, "utf8");
          // Handle empty or whitespace files safely
          if (content.trim() !== "") {
            config = JSON.parse(content);
          }
        } catch (err: any) {
          if (err.code !== "ENOENT") {
            process.stderr.write(`⚠️ Could not read or parse ${target.name} at ${target.path}: ${err.message}\n`);
            continue;
          }
        }

        const key = target.key;
        if (!config[key]) {
          config[key] = {};
        }
        config[key]["gitlab-duo"] = newConfigEntry;
      }

      // Ensure directory exists (just in case)
      await fs.mkdir(parentDir, { recursive: true });

      // Write config back
      await fs.writeFile(target.path, JSON.stringify(config, null, 2), "utf8");
      process.stderr.write(`✅ Successfully configured: ${target.name}\n   └─ Path: ${target.path}\n`);
      configuredCount++;
    } catch (err: any) {
      process.stderr.write(`❌ Error configuring ${target.name} at ${target.path}: ${err.message}\n`);
    }
  }

  process.stderr.write("\n");
  if (configuredCount > 0) {
    process.stderr.write(`🎉 Configuration complete! Successfully configured ${configuredCount} MCP client(s).\n`);
    process.stderr.write("Remember to restart or reload your AI client to detect the 'duo_review' tool.\n");
    await checkGitLabConnection();
    printMiniGuide();
  } else {
    process.stderr.write("⚠️ No clients were configured.\n");
  }
}

async function checkGitLabConnection(): Promise<void> {
  process.stderr.write("\nChecking GitLab CLI installation and connection...\n");
  try {
    const { stdout } = await execAsync("glab auth status");
    process.stderr.write("✅ GitLab CLI and connection verified successfully!\n");
    if (stdout) {
      process.stderr.write(
        stdout
          .trim()
          .split("\n")
          .map((line) => `   ${line}`)
          .join("\n") + "\n\n"
      );
    }
  } catch (err: any) {
    process.stderr.write("⚠️ Connection check failed or GitLab CLI not fully authenticated:\n");
    if (err.code === "ENOENT" || (err.message && err.message.includes("not found"))) {
      process.stderr.write("   Could not find the 'glab' executable. Please make sure GitLab CLI is installed and added to your PATH.\n\n");
    } else {
      const errorOutput = err.stderr || err.stdout || err.message || String(err);
      process.stderr.write(
        errorOutput
          .trim()
          .split("\n")
          .map((line: string) => `   ${line}`)
          .join("\n") + "\n\n"
      );
    }
  }
}

function printMiniGuide(): void {
  process.stderr.write(`📋 QUICK COMMAND & USAGE GUIDE
=============================

1. How to ask your AI agent to run a review:
   - "Review my current uncommitted changes with @duo_review"
   - "Run @duo_review on src/auth.ts and src/db.ts"
   - "Use @duo_review with model: sonnet to review this project"

2. AI Model Abstractions (Friendly Names):
   You can use simple, friendly model names instead of complex GitLab identifiers!
   The bridge automatically maps them for you:
   
   • sonnet      -> claude_sonnet_4_6
   • haiku       -> claude_haiku_4_5_20251001
   • opus        -> claude_opus_4_5_20251101
   • gpt5        -> gpt_5
   • gpt5-mini   -> gpt_5_mini
   • gpt5-codex  -> gpt_5_codex
   • gemini      -> gemini_2_5_flash_vertex

3. How to use friendly models:
   - In your agent's config or env: set GITLAB_DUO_MODEL="sonnet"
   - In your prompt: "Review with @duo_review using model: gemini"

=============================\n\n`);
}
