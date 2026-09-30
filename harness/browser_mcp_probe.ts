#!/usr/bin/env bun
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: [
    "node_modules/@playwright/mcp/cli.js",
    "--isolated",
    "--browser",
    "chrome",
    "--caps",
    "devtools",
    "--no-webmcp",
  ],
  cwd: process.cwd(),
});
const client = new Client({ name: "whole-lens-browser-probe", version: "1.0.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const navigate = tools.tools.find((tool) => tool.name === "browser_navigate");
  if (!navigate) throw new Error("browser_navigate_unavailable");
  const result = await client.callTool({
    name: "browser_navigate",
    arguments: { url: "https://developers.openai.com/learn/docs-mcp" },
  });
  if (result.isError) throw new Error("public_navigation_failed");
  process.stdout.write(JSON.stringify({
    connected: true,
    browserToolCount: tools.tools.length,
    publicNavigation: "ok",
    inspectionTools: tools.tools
      .filter((tool) => ["browser_navigate", "browser_snapshot", "browser_click", "browser_evaluate"].includes(tool.name))
      .map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema })),
  }) + "\n");
} finally {
  await client.close();
}
