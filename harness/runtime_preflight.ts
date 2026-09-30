#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Socket } from "node:net";
import { resolve } from "node:path";

type ProjectConfig = {
  sandbox_mode?: unknown;
  approval_policy?: unknown;
  model_context_window?: unknown;
  model_auto_compact_token_limit?: unknown;
  mcp_servers?: {
    openaiDeveloperDocs?: { url?: unknown };
    localBrowser?: { command?: unknown; args?: unknown };
    chromeDevTools?: { command?: unknown; args?: unknown };
  };
};

const root = resolve(import.meta.dir, "..");
const configPath = resolve(root, ".codex/config.toml");
const playwrightScript = resolve(root, "node_modules/@playwright/mcp/cli.js");
const chromeDevToolsScript = resolve(root, "node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js");
const hosts = ["dc.gang-a.kr", "storage.studyq.net", "developers.openai.com"] as const;

function declaredScriptMatches(args: string[], expected: string): boolean {
  return typeof args[0] === "string"
    && resolve(root, args[0]) === expected
    && existsSync(expected);
}

async function tcp443(host: string): Promise<boolean> {
  return await new Promise<boolean>((done) => {
    const socket = new Socket();
    let settled = false;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      done(connected);
    };
    socket.setTimeout(3_000, () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(443, host, () => finish(true));
  });
}

export function inspectProjectConfig(parsed: ProjectConfig | null) {
  if (parsed === null) return null;
  const browser = parsed.mcp_servers?.localBrowser;
  const browserArgs = Array.isArray(browser?.args) && browser.args.every(arg => typeof arg === "string")
    ? browser.args as string[] : [];
  const devtools = parsed.mcp_servers?.chromeDevTools;
  const devtoolsArgs = Array.isArray(devtools?.args) && devtools.args.every(arg => typeof arg === "string")
    ? devtools.args as string[] : [];
  return {
    sandboxMode: parsed.sandbox_mode ?? null,
    approvalPolicy: parsed.approval_policy ?? null,
    modelContextWindowConfigured: parsed.model_context_window ?? null,
    autoCompactThresholdConfigured: parsed.model_auto_compact_token_limit ?? null,
    docsMcpConfigured: parsed.mcp_servers?.openaiDeveloperDocs?.url === "https://developers.openai.com/mcp",
    playwrightChromeConfigured: browser?.command === "node"
      && declaredScriptMatches(browserArgs, playwrightScript)
      && browserArgs.includes("--isolated") && browserArgs.includes("--browser")
      && browserArgs.includes("chrome") && browserArgs.includes("--caps")
      && browserArgs.includes("devtools"),
    localBrowserPackagePresent: existsSync(playwrightScript),
    localBrowserDeclaredScriptValid: declaredScriptMatches(browserArgs, playwrightScript),
    chromeDevToolsConfigured: devtools?.command === "node"
      && declaredScriptMatches(devtoolsArgs, chromeDevToolsScript)
      && devtoolsArgs.includes("--user-data-dir=C:/Users/dcgan/AppData/Local/dc-gang-a-chrome-devtools-profile")
      && devtoolsArgs.includes("--redact-network-headers")
      && devtoolsArgs.includes("--no-usage-statistics"),
    chromeDevToolsPackagePresent: existsSync(chromeDevToolsScript),
    chromeDevToolsDeclaredScriptValid: declaredScriptMatches(devtoolsArgs, chromeDevToolsScript),
  };
}

function listedMcpServers() {
  try {
    const listing = execFileSync("codex", ["mcp", "list"], {
      cwd: root, encoding: "utf8", timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const enabled = (name: string) => listing.split(/\r?\n/).some(line =>
      line.trimStart().startsWith(`${name} `) && /\benabled\b/.test(line));
    return { cliListAvailable: true, registeredEnabled: {
      localBrowser: enabled("localBrowser"), openaiDeveloperDocs: enabled("openaiDeveloperDocs"),
      chromeDevTools: enabled("chromeDevTools"),
    }, connectionVerified: false };
  } catch {
    return { cliListAvailable: false, registeredEnabled: null, connectionVerified: false };
  }
}

export async function runRuntimePreflight(args = process.argv.slice(2)): Promise<void> {
  if (args.some((arg) => !["--network", "--mcp", "--json"].includes(arg))) throw new Error("invalid_arguments");
  const contents = await readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const parsed = contents === null ? null : Bun.TOML.parse(contents) as ProjectConfig;
  const network = args.includes("--network")
    ? Object.fromEntries(await Promise.all(hosts.map(async (host) => [host, await tcp443(host)] as const)))
    : null;
  const output = {
    repoRoot: root,
    projectConfigPresent: parsed !== null,
    projectDeclared: inspectProjectConfig(parsed),
    networkTcp443: network,
    mcpRegistration: args.includes("--mcp") ? listedMcpServers() : null,
    effectiveSession: {
      permissionPolicy: "unverified_by_project_preflight",
      activeModelCapacity: "unverified_by_project_preflight",
      mcpConnection: "unverified_by_cli_listing",
      browserAccountAndTab: "requires_current_browser_observation",
      googleDriveConnection: "requires_current_connector_call",
    },
    interpretation: "Configured context and compaction values are preferences; registration and TCP reachability do not prove connection, authentication, or active model capacity.",
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

if (import.meta.main) {
  try {
    await runRuntimePreflight();
  } catch {
    process.stderr.write(JSON.stringify({ status: "blocked", reason: "runtime_preflight_failed" }) + "\n");
    process.exitCode = 1;
  }
}
