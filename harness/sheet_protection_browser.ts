#!/usr/bin/env bun
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const target = "https://docs.google.com/spreadsheets/d/1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg/edit#gid=1754681846";
const transport = new StdioClientTransport({
  command: "node",
  args: ["node_modules/@playwright/mcp/cli.js", "--isolated", "--browser", "chrome", "--caps", "devtools", "--no-webmcp"],
  cwd: process.cwd(),
});
const client = new Client({ name: "whole-lens-sheet-protection", version: "1.0.0" });

async function inspect() {
  const result = await client.callTool({
    name: "browser_evaluate",
    arguments: {
      function: "() => ({ origin: location.origin, path: location.pathname, accounts: [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label') || '').filter(v => v.startsWith('Google 계정:')).slice(0, 3), menuLabels: [...document.querySelectorAll('[role=menuitem]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()).filter(v => /보호|Protect|시트|범위|데이터/.test(v)).slice(0, 30), dataElements: [...document.querySelectorAll('[role=menuitem]')].filter(e => (e.getAttribute('aria-label') || e.textContent || '').trim() === '데이터').map(e => e.outerHTML.slice(0, 500)), protectionElements: [...document.querySelectorAll('[role=menuitem]')].filter(e => (e.getAttribute('aria-label') || e.textContent || '').includes('시트 및 범위 보호')).map(e => e.outerHTML.slice(0, 500)) })",
    },
  });
  if (result.isError) throw new Error("browser_status_failed");
  const text = result.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
  const match = text.match(/### Result\s*([\s\S]*?)\s*### Ran Playwright code/);
  return match ? JSON.parse(match[1]) : { parsed: false };
}

let exitCode = 0;
try {
  await client.connect(transport);
  const opened = await client.callTool({ name: "browser_navigate", arguments: { url: target } });
  if (opened.isError) throw new Error("sheet_navigation_failed");
  if (process.argv.includes("--wait-login")) {
    process.stdout.write("Browser open for teacher sign-in. Waiting for ready signal.\n");
    await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
  }
  const before = await inspect();
  process.stdout.write(JSON.stringify({ before }) + "\n");
  const menuId = before.dataElements?.[0]?.match(/id="([^"]+)"/)?.[1];
  if (!menuId) throw new Error("data_menu_id_missing");
  const clicked = await client.callTool({ name: "browser_click", arguments: { target: `[id="${menuId}"]`, element: "데이터 메뉴" } });
  if (clicked.isError) throw new Error("data_menu_unavailable:" + JSON.stringify(clicked.content?.filter((item) => item.type === "text").map((item) => item.text.slice(0, 400))));
  const dataMenu = await inspect();
  const protectionId = dataMenu.protectionElements?.[0]?.match(/id="([^"]+)"/)?.[1];
  if (!protectionId) throw new Error("protection_menu_id_missing:" + JSON.stringify(dataMenu));
  const openedProtection = await client.callTool({ name: "browser_click", arguments: { target: `[id="${protectionId}"]`, element: "시트 및 범위 보호 메뉴" } });
  if (openedProtection.isError) throw new Error("protection_panel_unavailable");
  const panel = await client.callTool({ name: "browser_snapshot", arguments: { depth: 5 } });
  const panelText = (panel.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
  const panelLines = panelText.split("\n").filter((line) => /보호|범위|박경찬|Protected|range/i.test(line)).slice(0, 50);
  const panelStart = panelText.indexOf('complementary "보호된 시트 및 범위"');
  const sidebarSnapshot = panelStart >= 0 ? panelText.slice(panelStart, panelStart + 2500) : "";
  const cancelRef = sidebarSnapshot.match(/button "취소" \[ref=([^\]]+)\]/)?.[1];
  if (cancelRef) {
    const cancelled = await client.callTool({ name: "browser_click", arguments: { target: cancelRef, element: "새 보호 범위 편집 취소" } });
    if (cancelled.isError) throw new Error("protection_editor_cancel_failed");
  }
  const afterCancel = await client.callTool({ name: "browser_snapshot", arguments: { depth: 6 } });
  const afterText = (afterCancel.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
  const afterStart = afterText.indexOf('complementary "보호된 시트 및 범위"');
  const existingProtectionList = afterStart >= 0 ? afterText.slice(afterStart, afterStart + 3500) : "";
  const sidebar = await client.callTool({ name: "browser_evaluate", arguments: { function: "() => ({ text: (document.querySelector('[aria-label=\"보호된 시트 및 범위\"]')?.innerText || '').slice(0, 3000) })" } });
  const sidebarText = sidebar.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
  const sidebarMatch = sidebarText.match(/### Result\s*([\s\S]*?)\s*### Ran Playwright code/);
  process.stdout.write(JSON.stringify({ browserOpened: true, target: "operating_Park_tab", panelLines, sidebarSnapshot, existingProtectionList, sidebar: sidebarMatch ? JSON.parse(sidebarMatch[1]) : { parsed: false } }) + "\n");
} catch (error) {
  exitCode = 1;
  process.stderr.write((error instanceof Error ? error.message : "browser_probe_failed") + "\n");
} finally {
  await Promise.race([client.close(), new Promise((resolve) => setTimeout(resolve, 1000))]);
  process.exit(exitCode);
}
