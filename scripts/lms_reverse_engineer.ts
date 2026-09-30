/**
 * LMS Deterministic Reverse Engineering CLI Tool.
 * 
 * Analyzes:
 * 1. Linked JavaScript bundles and inline scripts from any LMS page.
 * 2. AJAX call patterns (`$.ajax`, `fetch`, `XMLHttpRequest`) and target servlet URLs.
 * 3. Function chains (e.g. `externOn*`, `onPopup*`, `MODULE.*`).
 * 4. Extracts parameter shapes and outputs typed route candidate schemas.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface DiscoveredEndpoint {
  url: string;
  method?: string;
  foundIn: string;
  contextSnippet: string;
  parameters: string[];
}

export interface DiscoveredFunction {
  name: string;
  params: string[];
  snippet: string;
}

export class LmsReverseEngineerEngine {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://dc.gang-a.kr') {
    this.baseUrl = baseUrl;
  }

  public analyzeHtml(html: string, sourceName: string): {
    scripts: string[];
    endpoints: DiscoveredEndpoint[];
    functions: DiscoveredFunction[];
  } {
    const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
    const scripts: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(html)) !== null) {
      scripts.push(match[1]);
    }

    const endpointRegex = /["'](\/(?:servlet\/controller|renwal|jsutil)[^"'\s\?#]+(?:\?[^"'\s]+)?)["']/gi;
    const endpointsMap: Map<string, DiscoveredEndpoint> = new Map();

    while ((match = endpointRegex.exec(html)) !== null) {
      const rawUrl = match[1];
      const start = Math.max(0, match.index - 80);
      const end = Math.min(html.length, match.index + match[0].length + 120);
      const snippet = html.substring(start, end);

      const isPost = snippet.toLowerCase().includes('type:"post"') || snippet.toLowerCase().includes("type: 'post'") || snippet.toLowerCase().includes('method="post"');
      const method = isPost ? 'POST' : 'GET';

      const paramMatches = [...snippet.matchAll(/(?:data|params?|param|condition)\s*[:=]\s*["']?([^"',;{}]+)/gi)];
      const parameters = paramMatches.map(p => p[1].trim());

      if (!endpointsMap.has(rawUrl)) {
        endpointsMap.set(rawUrl, {
          url: rawUrl,
          method,
          foundIn: sourceName,
          contextSnippet: snippet.trim(),
          parameters
        });
      }
    }

    const funcRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*\{/g;
    const functions: DiscoveredFunction[] = [];
    while ((match = funcRegex.exec(html)) !== null) {
      const name = match[1];
      const params = match[2].split(',').map(p => p.trim()).filter(Boolean);
      const start = match.index;
      const snippet = html.substring(start, Math.min(html.length, start + 300));
      functions.push({ name, params, snippet });
    }

    return {
      scripts,
      endpoints: Array.from(endpointsMap.values()),
      functions
    };
  }

  public analyzeJsBundle(jsText: string, scriptUrl: string): DiscoveredEndpoint[] {
    const endpoints: DiscoveredEndpoint[] = [];
    const servletRegex = /["'](\/servlet\/controller[^"'\s]+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = servletRegex.exec(jsText)) !== null) {
      const rawUrl = match[1];
      const start = Math.max(0, match.index - 100);
      const end = Math.min(jsText.length, match.index + match[0].length + 200);
      const snippet = jsText.substring(start, end);

      const isPost = snippet.toLowerCase().includes('post');
      endpoints.push({
        url: rawUrl,
        method: isPost ? 'POST' : 'GET',
        foundIn: scriptUrl,
        contextSnippet: snippet.trim(),
        parameters: []
      });
    }

    return endpoints;
  }
}

// Historical direct probe is disabled; source parsing does not establish a read contract.
if (import.meta.main) {
  console.error(JSON.stringify({ ok: false, code: 'unverified_live_probe_retired', replacement: 'harness/lead.ts' }));
  process.exitCode = 1;
}
