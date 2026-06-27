import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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

  process.stderr.write("Iniciando la configuración automática de gitlab-duo-mcp-bridge...\n\n");

  let configuredCount = 0;

  for (const target of targets) {
    const parentDir = path.dirname(target.path);

    try {
      // Check if parent directory exists
      await fs.access(parentDir);
    } catch {
      // Parent directory does not exist, so client is likely not installed or used. Skip it.
      continue;
    }

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
            process.stderr.write(`⚠️ No se pudo leer o parsear ${target.name} en ${target.path}: ${err.message}\n`);
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
      process.stderr.write(`✅ Configurado con éxito: ${target.name}\n   └─ Ruta: ${target.path}\n`);
      configuredCount++;
    } catch (err: any) {
      process.stderr.write(`❌ Error al configurar ${target.name} en ${target.path}: ${err.message}\n`);
    }
  }

  process.stderr.write("\n");
  if (configuredCount > 0) {
    process.stderr.write(`🎉 ¡Configuración completa! Se configuraron ${configuredCount} cliente(s) MCP.\n`);
    process.stderr.write("Recuerda reiniciar o recargar tu cliente de IA para que detecte la herramienta 'duo_review'.\n");
  } else {
    process.stderr.write("⚠️ No se encontraron directorios de configuración de clientes MCP activos.\n");
    process.stderr.write("Si usas Claude Desktop, Cursor, Cline, Roo Code, Windsurf, Zed o Continue, asegúrate de haberlos instalado e iniciado al menos una vez.\n");
  }
}
