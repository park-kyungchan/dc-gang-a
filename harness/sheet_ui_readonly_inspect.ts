#!/usr/bin/env bun
/**
 * Read-only, interactive inspection of the operating Park sheet in Chrome.
 *
 * bun run harness/sheet_ui_readonly_inspect.ts --isolated
 * bun run harness/sheet_ui_readonly_inspect.ts --extension
 *
 * The first mode opens a one-time in-memory Chrome session for teacher sign-in.
 * The second requires the Playwright Extension in the already signed-in Chrome.
 * Neither mode reads cookies, storage state, network headers or cell contents.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = "C:/Users/dcgan/OneDrive/Desktop/dc-gang-a";
const spreadsheetId = "1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg";
const parkSheetId = "1754681846";
const target = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${parkSheetId}`;
const mode = process.argv.includes("--extension") ? "extension" : "isolated";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(
    "Usage: bun run harness/sheet_ui_readonly_inspect.ts [--isolated|--extension]\n" +
    "--isolated: one in-memory Chrome, teacher signs in once in its visible window.\n" +
    "--extension: attach to already open Chrome with the Playwright Extension installed.\n" +
    "The script prints only structural observations and never writes the Sheet.\n",
  );
  process.exit(0);
}
if (process.argv.includes("--extension") && process.argv.includes("--isolated")) {
  throw new Error("Select exactly one browser mode.");
}

const args = [
  `${projectRoot}/node_modules/@playwright/mcp/cli.js`,
  mode === "extension" ? "--extension" : "--isolated",
  "--browser", "chrome",
  "--no-webmcp",
  "--snapshot-mode", "none",
  "--image-responses", "omit",
];
const transport = new StdioClientTransport({ command: "node", args, cwd: projectRoot });
const client = new Client({ name: "whole-lens-sheet-ui-readonly", version: "1.0.0" });

async function tool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args }) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  if (result.isError) throw new Error(`${name} failed`);
  return result;
}

async function evaluate<T>(functionSource: string): Promise<T> {
  const result = await tool("browser_evaluate", { function: functionSource });
  const body = (result.content ?? [])
    .flatMap((item) => item.type === "text" && typeof item.text === "string" ? [item.text] : [])
    .join("\n");
  const value = body.match(/### Result\s*([\s\S]*?)(?:\s*### Ran Playwright code|$)/)?.[1];
  if (!value) throw new Error("Browser returned no structured result");
  try { return JSON.parse(value) as T; }
  catch { throw new Error("Browser returned an unparseable result"); }
}

function enter(prompt: string): Promise<void> {
  process.stdout.write(`${prompt}\nPress Enter here when ready.\n`);
  return new Promise((resolve) => process.stdin.once("data", () => resolve()));
}

type PageState = {
  exactWorkbook: boolean;
  parkTab: boolean;
  teacherAccountMatched: boolean;
  protectedPanel: boolean;
};
const stateSource = `() => ({
  exactWorkbook: location.origin === "https://docs.google.com" && location.pathname === "/spreadsheets/d/${spreadsheetId}/edit",
  parkTab: location.hash.includes("gid=${parkSheetId}"),
  teacherAccountMatched: [...document.querySelectorAll("[aria-label]")].some(e => /^(Google 계정|Google Account):/.test(e.getAttribute("aria-label") || "") && (e.getAttribute("aria-label") || "").includes("박경찬")),
  protectedPanel: !!(document.querySelector('[aria-label="보호된 시트 및 범위"], [aria-label="Protected sheets and ranges"]')
    || [...document.querySelectorAll('[role="complementary"]')].find(e => /보호된 시트 및 범위|Protected sheets and ranges/.test(e.textContent || '')))
})`;

// Only range addresses, counts and protection-mode flags leave the page.
const protectionSource = `() => {
  const panel = document.querySelector('[aria-label="보호된 시트 및 범위"], [aria-label="Protected sheets and ranges"]')
    || [...document.querySelectorAll('[role="complementary"]')].find(e => /보호된 시트 및 범위|Protected sheets and ranges/.test(e.textContent || ''));
  if (!panel) return { panelOpen: false, candidateCount: 0, parkCandidateCount: 0, parkEnabledCount: 0, rangeRefs: [] };
  const s = panel.innerText || "";
  const ranges = s.match(/\\$?[A-Z]{1,3}\\$?\\d+(?::\\$?[A-Z]{1,3}\\$?\\d+)?/g) || [];
  const candidates = [...panel.querySelectorAll('button,[role="button"],[role="listitem"]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const parkCandidates = candidates.filter(e => (e.innerText || '').includes('박경찬'));
  const enabled = e => !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[aria-disabled="true"]');
  return {
    panelOpen: true,
    candidateCount: candidates.length,
    parkCandidateCount: parkCandidates.length,
    parkEnabledCount: parkCandidates.filter(enabled).length,
    rangeRefs: [...new Set(ranges)].slice(0, 100),
  };
}`;

const openParkRuleSource = `async () => {
  const panel = document.querySelector('[aria-label="보호된 시트 및 범위"], [aria-label="Protected sheets and ranges"]')
    || [...document.querySelectorAll('[role="complementary"]')].find(e => /보호된 시트 및 범위|Protected sheets and ranges/.test(e.textContent || ''));
  if (!panel) return { opened: false, reason: 'panel_missing' };
  const candidates = [...panel.querySelectorAll('button,[role="button"],[role="listitem"]')]
    .filter(e => (e.innerText || '').includes('박경찬'))
    .filter(e => !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[aria-disabled="true"]'));
  const target = candidates.find(e => !(e.querySelector('button,[role="button"], [role="listitem"]')) ) || candidates.at(-1);
  if (!target) return { opened: false, reason: 'park_rule_not_enabled' };
  target.click();
  await new Promise(resolve => setTimeout(resolve, 500));
  return { opened: true };
}`;

const detailSource = `() => {
  const panel = document.querySelector('[aria-label="보호된 시트 및 범위"], [aria-label="Protected sheets and ranges"]')
    || [...document.querySelectorAll('[role="complementary"]')].find(e => /보호된 시트 및 범위|Protected sheets and ranges/.test(e.textContent || ''));
  if (!panel) return { detailOpen: false, exceptionRanges: [], allVisibleRanges: [], exceptionSectionVisible: false, warningOnly: false, editorRestrictionVisible: false };
  const s = panel.innerText || '';
  const rangePattern = /\\$?[A-Z]{1,3}\\$?\\d+(?::\\$?[A-Z]{1,3}\\$?\\d+)?/g;
  const marker = s.search(/특정 셀 제외|다음 셀 제외|예외|Except certain cells|Except these cells/i);
  const exceptionText = marker >= 0 ? s.slice(marker, marker + 600) : '';
  return {
    detailOpen: /시트|Sheet/.test(s) && /박경찬/.test(s),
    exceptionRanges: [...new Set(exceptionText.match(rangePattern) || [])].slice(0, 20),
    allVisibleRanges: [...new Set(s.match(rangePattern) || [])].slice(0, 30),
    exceptionSectionVisible: marker >= 0,
    warningOnly: /경고|warning/i.test(s),
    editorRestrictionVisible: /편집할 수 있는 사용자|Restrict who can edit|권한 변경|Change permissions/i.test(s),
  };
}`;

let exitCode = 0;
try {
  await client.connect(transport);
  if (mode === "extension") {
    // A new tab reuses the signed-in browser without changing an existing tab.
    await tool("browser_tabs", { action: "new", url: target });
  } else {
    await tool("browser_navigate", { url: target });
  }
  await enter(mode === "extension"
    ? "A new operating Sheet tab is open in Chrome. Confirm its account and tab."
    : "Sign in to the academy Google account in the newly opened Chrome window, then open the Park tab.");
  const state = await evaluate<PageState>(stateSource);
  process.stdout.write(JSON.stringify({ mode, target: "operating_Park_tab", state }) + "\n");
  if (!state.exactWorkbook || !state.parkTab || !state.teacherAccountMatched) {
    throw new Error("Expected authenticated operating Park tab is not verified");
  }
  await enter("In the Sheet, open Data > Protect sheets and ranges. If a new-rule editor appears, click Cancel to show existing rules. Do not save or edit a rule.");
  const after = await evaluate<PageState>(stateSource);
  if (!after.exactWorkbook || !after.parkTab || !after.protectedPanel) {
    throw new Error("The existing-protections panel is not open on the expected tab");
  }
  const summary = await evaluate<Record<string, unknown>>(protectionSource);
  process.stdout.write(JSON.stringify({ target: "operating_Park_tab", protectionPanel: summary }) + "\n");
  if (summary.parkCandidateCount && summary.parkEnabledCount === 0) {
    throw new Error("Park protection rule is disabled in this account; no rule was opened");
  }
  if (summary.parkEnabledCount === 1) {
    const opened = await evaluate<{ opened: boolean; reason?: string }>(openParkRuleSource);
    if (!opened.opened) throw new Error(`Park protection rule could not be opened: ${opened.reason ?? "unknown"}`);
  } else {
    await enter("Select the existing Park protection rule in the sidebar to view its details. Do not edit or save it.");
  }
  const detail = await evaluate<{ detailOpen: boolean; exceptionRanges: string[]; exceptionSectionVisible: boolean }>(detailSource);
  process.stdout.write(JSON.stringify({ target: "operating_Park_tab", protectionDetail: detail }) + "\n");
  if (!detail.detailOpen || !detail.exceptionSectionVisible || detail.exceptionRanges.length !== 2) {
    throw new Error("Two Park exception ranges were not verified in the protection detail");
  }
  process.stdout.write("For exact merged ranges and row/column pixel sizes, use native Sheets metadata; the canvas UI does not provide complete structural enumeration.\n");
} catch (error) {
  exitCode = 1;
  process.stderr.write((error instanceof Error ? error.message : "Sheet inspection failed") + "\n");
} finally {
  await Promise.race([client.close(), new Promise((resolve) => setTimeout(resolve, 1000))]);
  process.exit(exitCode);
}
