import { expect, test } from "bun:test";
import { planFullAccessConfig } from "../../harness/codex_full_access";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("full-access config update preserves unrelated TOML and rejects policy conflicts", () => {
  const before = 'model = "gpt-6-sol"\n[features]\nweb_search = true\n';
  const planned = planFullAccessConfig(before);
  const config = Bun.TOML.parse(planned) as Record<string, unknown>;
  expect(config.sandbox_mode).toBe("danger-full-access");
  expect(config.approval_policy).toBe("never");
  expect(config.web_search).toBe("live");
  expect(config.model_auto_compact_token_limit).toBe(872000);
  expect(config.model_context_window).toBe(1050000);
  expect(config.model).toBe("gpt-6-sol");
  expect((config.mcp_servers as Record<string, { args: string[]; url?: string }>).openaiDeveloperDocs.url).toBe("https://developers.openai.com/mcp");
  const reviewedProfile = Bun.TOML.parse(readFileSync(resolve(import.meta.dir, "../../harness/codex-project-full-access.toml"), "utf8")) as Record<string, unknown>;
  expect(config.sandbox_mode).toBe(reviewedProfile.sandbox_mode);
  expect(config.approval_policy).toBe(reviewedProfile.approval_policy);
  expect(config.web_search).toBe(reviewedProfile.web_search);
  expect(config.model_auto_compact_token_limit).toBe(reviewedProfile.model_auto_compact_token_limit);
  expect(config.model_context_window).toBe(reviewedProfile.model_context_window);
  expect((config.mcp_servers as Record<string, { args: string[]; url?: string }>).localBrowser.args.slice(1)).toEqual(
    (reviewedProfile.mcp_servers as Record<string, { args: string[] }>).localBrowser.args.slice(1));
  expect((config.mcp_servers as Record<string, { args: string[]; url?: string }>).chromeDevTools.args.slice(1)).toEqual(
    (reviewedProfile.mcp_servers as Record<string, { args: string[] }>).chromeDevTools.args.slice(1));
  expect(planFullAccessConfig(planned)).toBe(planned);
  expect(() => planFullAccessConfig('approval_policy = "on-request"\n')).toThrow();
});
