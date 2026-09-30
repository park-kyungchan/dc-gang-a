#!/usr/bin/env bun
/** Project-local Chrome DevTools MCP client with bounded structural output. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const teacherOrigin = "https://dc.gang-a.kr";
const safeLabels = ["로그인", "강의관리", "강의하는 아이들", "계정 연결정보 안내"] as const;
const roles = ["RootWebArea", "heading", "link", "button", "textbox", "combobox", "checkbox", "radio", "table", "row", "cell", "form", "navigation", "main", "dialog", "alert"] as const;
const safeQueryKeys = new Set(["p_process", "std_ymd", "grp_seq", "std_seq", "pageno", "page"]);
const safeRoutes = new Set(["/servlet/controller.tutor.TutorMenuIndexServlet"]);
const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(root, "node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js"),
    "--user-data-dir=C:/Users/dcgan/AppData/Local/dc-gang-a-chrome-devtools-profile",
    "--redact-network-headers", "--no-usage-statistics", "--no-performance-crux"],
  cwd: root,
});
const client = new Client({ name: "whole-lens-native-devtools-session", version: "1.0.0" });
type ToolResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown> };
type ListedPage = { id: number; url: string };
const emit = (value: object) => process.stdout.write(JSON.stringify(value) + "\n");
const textBody = (result: unknown): string => {
  const content = (result as ToolResult)?.content;
  return Array.isArray(content) ? content.filter(part => part.type === "text")
    .map(part => part.text ?? "").join("\n") : "";
};

export function isTeacherUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === teacherOrigin && !url.username && !url.password;
  } catch { return false; }
}

export function publicTabs(pages: ListedPage[]): { id: number; teacherSite: true }[] {
  return pages.filter(page => Number.isSafeInteger(page.id) && page.id > 0 && isTeacherUrl(page.url))
    .map(page => ({ id: page.id, teacherSite: true as const })).slice(0, 20);
}

export function structuralSnapshot(body: string) {
  const lines = body.split(/\r?\n/);
  const entries = lines.flatMap(line => {
    const role = roles.find(candidate => new RegExp(`\\b${candidate}\\b`).test(line));
    if (!role) return [];
    const label = safeLabels.find(candidate => line.includes(candidate)) ?? "redacted";
    return [{ role, label }];
  });
  return { totalLines: lines.length, structuralEntries: entries.slice(0, 40), truncated: entries.length > 40 };
}

export function networkSummary(body: string) {
  const requestLines = body.split(/\r?\n/).filter(line => /\breqid=\d+\b/.test(line));
  const requestShapes = requestLines.flatMap(line => {
    const match = line.match(/\breqid=\d+\s+(GET|POST|PUT|DELETE|PATCH)\s+(https?:\/\/\S+)/);
    if (!match) return [];
    try {
      const url = new URL(match[2]);
      if (!isTeacherUrl(url.href)) return [];
      const routeTemplate = safeRoutes.has(url.pathname)
        ? url.pathname : "redacted";
      return [{ method: match[1], routeTemplate,
        queryKeys: [...new Set([...url.searchParams.keys()].filter(key => safeQueryKeys.has(key)))].sort(),
        queryKeyCount: [...url.searchParams.keys()].length,
        status: line.match(/\[([1-5]\d\d)\]/)?.[1] ?? "unknown" }];
    } catch { return []; }
  });
  return { requestLineCount: requestLines.length, requestShapes: requestShapes.slice(0, 20),
    truncated: requestShapes.length > 20, bodiesOrHeadersEmitted: false };
}

async function listPages(): Promise<ListedPage[]> {
  const result = await client.callTool({ name: "list_pages", arguments: {} });
  if (result.isError) throw new Error("page_list_unavailable");
  const pages = (result.structuredContent as Record<string, unknown> | undefined)?.pages;
  if (!Array.isArray(pages)) throw new Error("page_list_unstructured");
  return pages.filter((page): page is ListedPage => typeof page === "object" && page !== null
    && typeof page.id === "number" && typeof page.url === "string");
}

async function selectBoundPage(boundPageId: number | null): Promise<boolean> {
  if (boundPageId === null) return false;
  const page = (await listPages()).find(entry => entry.id === boundPageId);
  if (!page || !isTeacherUrl(page.url)) return false;
  const selected = await client.callTool({ name: "select_page", arguments: { pageId: boundPageId } });
  return !selected.isError;
}

export function safeBrowserState(body: string) {
  const encoded = body.match(/\{[^{}]*\}/)?.[0];
  try {
    const value = JSON.parse(encoded ?? "null") as Record<string, unknown> | null;
    if (value?.teacherOrigin !== true) return null;
    return { teacherOrigin: true, passwordInputPresent: value.passwordInputPresent === true,
      readyState: ["loading", "interactive", "complete"].includes(String(value.readyState))
        ? value.readyState : "unknown",
      formCount: typeof value.formCount === "number" ? Math.min(20, Math.max(0, value.formCount)) : 0 };
  } catch { return null; }
}

export async function runChromeDevToolsSession(): Promise<void> {
  let boundPageId: number | null = null;
  try {
    await client.connect(transport);
    emit({ status: "chrome_ready_unbound", tabs: publicTabs(await listPages()),
      commands: ["tabs", "bind <id>", "open", "course_menu", "status", "snapshot", "network", "stop"] });
    const input = createInterface({ input: process.stdin, terminal: false });
    for await (const line of input) {
      const command = line.trim();
      if (command === "stop") { emit({ status: "stopping" }); break; }
      try {
        if (command === "tabs") {
          emit({ status: "tabs", tabs: publicTabs(await listPages()), boundPageId });
        } else if (/^bind [1-9]\d*$/.test(command)) {
          const id = Number(command.slice(5));
          const page = (await listPages()).find(entry => entry.id === id);
          if (!Number.isSafeInteger(id) || !page || !isTeacherUrl(page.url)) {
            emit({ status: "bind_rejected" }); continue;
          }
          boundPageId = id;
          emit({ status: "bound", pageId: id });
        } else if (command === "open") {
          const result = await client.callTool({ name: "new_page", arguments: { url: `${teacherOrigin}/` } });
          boundPageId = null;
          emit({ status: result.isError ? "safe_page_open_failed" : "safe_page_opened_unbound",
            tabs: result.isError ? [] : publicTabs(await listPages()) });
        } else if (command === "course_menu") {
          if (!await selectBoundPage(boundPageId)) {
            boundPageId = null; emit({ status: "explicit_teacher_tab_binding_required" }); continue;
          }
          const result = await client.callTool({ name: "new_page", arguments: {
            url: `${teacherOrigin}/servlet/controller.tutor.TutorMenuIndexServlet?p_process=CourseManageIndex`,
          } });
          boundPageId = null;
          emit({ status: result.isError ? "safe_menu_navigation_failed" : "safe_menu_opened_unbound",
            tabs: result.isError ? [] : publicTabs(await listPages()) });
        } else if (["status", "snapshot", "network"].includes(command)) {
          if (!await selectBoundPage(boundPageId)) {
            boundPageId = null; emit({ status: "explicit_teacher_tab_binding_required" }); continue;
          }
          if (command === "status") {
            const result = await client.callTool({ name: "evaluate_script", arguments: {
              function: `() => ({teacherOrigin: location.origin === "${teacherOrigin}", passwordInputPresent: !!document.querySelector('input[type=password]'), readyState: document.readyState, formCount: document.forms.length})`,
            } });
            const state = result.isError ? null : safeBrowserState(textBody(result));
            if (!state) { boundPageId = null; emit({ status: "browser_state_unverified" }); }
            else emit({ status: "browser_state", pageId: boundPageId, state });
          } else if (command === "snapshot") {
            const result = await client.callTool({ name: "take_snapshot", arguments: { verbose: false } });
            emit({ status: result.isError ? "snapshot_unavailable" : "snapshot_summary",
              snapshot: result.isError ? null : structuralSnapshot(textBody(result)) });
          } else {
            const result = await client.callTool({ name: "list_network_requests", arguments: {
              pageSize: 50, pageIdx: 0, resourceTypes: ["document", "xhr", "fetch"],
            } });
            emit({ status: result.isError ? "network_unavailable" : "network_summary",
              network: result.isError ? null : networkSummary(textBody(result)) });
          }
        } else emit({ status: "unknown_command" });
      } catch { emit({ status: "command_failed", reason: "browser_tool_unavailable_or_tab_changed" }); }
    }
  } catch { emit({ status: "blocked", reason: "native_devtools_unavailable" }); process.exitCode = 1; }
  finally { await Promise.race([client.close(), new Promise(resolve => setTimeout(resolve, 1_000))]); }
}

if (import.meta.main) await runChromeDevToolsSession();
