#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Config = Record<string, unknown>;
const settings = 'sandbox_mode = "danger-full-access"\napproval_policy = "never"\nweb_search = "live"\nmodel_context_window = 1050000\nmodel_auto_compact_token_limit = 872000\n';
const docsMcp = '[mcp_servers.openaiDeveloperDocs]\nurl = "https://developers.openai.com/mcp"\n';
const browserCli = resolve(import.meta.dir, '../node_modules/@playwright/mcp/cli.js').replaceAll('\\', '/');
const browserMcp = `[mcp_servers.localBrowser]\ncommand = "node"\nargs = ["${browserCli}", "--isolated", "--browser", "chrome", "--caps", "devtools", "--no-webmcp"]\n`;
const devtoolsCli = resolve(import.meta.dir, '../node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js').replaceAll('\\', '/');
const devtoolsArgs = [devtoolsCli, '--user-data-dir=C:/Users/dcgan/AppData/Local/dc-gang-a-chrome-devtools-profile', '--redact-network-headers', '--no-usage-statistics', '--no-performance-crux'];
const devtoolsMcp = `[mcp_servers.chromeDevTools]\ncommand = "node"\nargs = ${JSON.stringify(devtoolsArgs)}\n`;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function planFullAccessConfig(current: string): string {
  const parsed = Bun.TOML.parse(current) as Config;
  const configuredBrowser = (parsed.mcp_servers as Record<string, Record<string, unknown>> | undefined)?.localBrowser;
  const configuredDevtools = (parsed.mcp_servers as Record<string, Record<string, unknown>> | undefined)?.chromeDevTools;
  if (parsed.sandbox_mode === 'danger-full-access' && parsed.approval_policy === 'never'
      && parsed.web_search === 'live' && parsed.model_context_window === 1050000
      && parsed.model_auto_compact_token_limit === 872000
      && (parsed.mcp_servers as Record<string, Record<string, unknown>> | undefined)?.openaiDeveloperDocs?.url === 'https://developers.openai.com/mcp'
      && configuredBrowser?.command === 'node'
      && JSON.stringify(configuredBrowser.args) === JSON.stringify([browserCli, '--isolated', '--browser', 'chrome', '--caps', 'devtools', '--no-webmcp'])
      && configuredDevtools?.command === 'node' && JSON.stringify(configuredDevtools.args) === JSON.stringify(devtoolsArgs)) {
    return current;
  }
  for (const key of ["sandbox_mode", "approval_policy", "default_permissions", "web_search", "model_context_window", "model_auto_compact_token_limit"]) {
    if (Object.hasOwn(parsed, key)) throw new Error(`existing_runtime_policy:${key}`);
  }
  if (parsed.mcp_servers && typeof parsed.mcp_servers === "object" && Object.hasOwn(parsed.mcp_servers, "openaiDeveloperDocs")) {
    throw new Error("existing_docs_mcp_policy");
  }
  if (parsed.mcp_servers && typeof parsed.mcp_servers === "object" && Object.hasOwn(parsed.mcp_servers, "localBrowser")) {
    throw new Error("existing_browser_mcp_policy");
  }
  if (parsed.mcp_servers && typeof parsed.mcp_servers === "object" && Object.hasOwn(parsed.mcp_servers, "chromeDevTools")) {
    throw new Error("existing_devtools_mcp_policy");
  }
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  const updated = settings + (current.length > 0 ? "\n" : "") + current + separator + (current.length > 0 ? "\n" : "") + docsMcp + "\n" + browserMcp + "\n" + devtoolsMcp;
  const next = Bun.TOML.parse(updated) as Config;
  if (next.sandbox_mode !== "danger-full-access" || next.approval_policy !== "never" || next.web_search !== "live" || next.model_context_window !== 1050000 || next.model_auto_compact_token_limit !== 872000) {
    throw new Error("config_validation_failed");
  }
  if ((next.mcp_servers as Record<string, Record<string, unknown>> | undefined)?.openaiDeveloperDocs?.url !== "https://developers.openai.com/mcp") {
    throw new Error("config_validation_failed");
  }
  if (JSON.stringify((next.mcp_servers as Record<string, Record<string, unknown>> | undefined)?.localBrowser?.args) !== JSON.stringify([browserCli, '--isolated', '--browser', 'chrome', '--caps', 'devtools', '--no-webmcp'])) {
    throw new Error("config_validation_failed");
  }
  if (JSON.stringify((next.mcp_servers as Record<string, Record<string, unknown>> | undefined)?.chromeDevTools?.args) !== JSON.stringify(devtoolsArgs)) {
    throw new Error("config_validation_failed");
  }
  return updated;
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (action !== "--preview" && action !== "--apply") throw new Error("use_preview_or_apply");
  const path = resolve(import.meta.dir, "../.codex/config.toml");
  const current = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const planned = planFullAccessConfig(current);
  const preview = {
    configPath: path,
    scope: "this_trusted_repository_only",
    action,
    currentSha256: hash(current),
    plannedSha256: hash(planned),
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    webSearch: "live",
    modelAutoCompactTokenLimit: 872000,
    modelContextWindowConfigured: 1050000,
    localBrowser: "Chrome isolated DevTools",
    chromeDevTools: "official Chrome DevTools MCP with a separate local profile and network header redaction",
    docsMcp: "https://developers.openai.com/mcp",
    takesEffect: "new_session_subject_to_runtime_or_managed_overrides",
  };
  if (action === "--preview") {
    process.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const backup = current.length > 0
    ? `${path}.pre-full-access-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`
    : null;
  if (backup) await copyFile(path, backup, constants.COPYFILE_EXCL);
  await writeFile(path, planned, { encoding: "utf8" });
  const saved = await readFile(path, "utf8");
  if (hash(saved) !== hash(planned)) throw new Error("readback_mismatch");
  process.stdout.write(JSON.stringify({ ...preview, status: "saved", backup }) + "\n");
}

if (import.meta.main) {
  try {
    await main();
  } catch (error: unknown) {
    const reason = error instanceof Error && /^(use_preview_or_apply|existing_runtime_policy:[a-z_]+|existing_docs_mcp_policy|existing_browser_mcp_policy|existing_devtools_mcp_policy|config_validation_failed|readback_mismatch)$/.test(error.message)
      ? error.message
      : "config_operation_failed";
    process.stderr.write(JSON.stringify({ status: "blocked", reason }) + "\n");
    process.exitCode = 1;
  }
}
