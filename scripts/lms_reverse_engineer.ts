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

async function main() {
  const cookie = process.env.SESSION_COOKIE;
  const engine = new LmsReverseEngineerEngine();

  console.log(`\n======================================================================`);
  console.log(`[LMS Deterministic Reverse Engineering Inspector]`);
  console.log(`======================================================================\n`);

  const targetUrl = 'https://dc.gang-a.kr/servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult&ass_no=1001';
  console.log(`>>> Target URL: ${targetUrl}`);

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
  if (cookie) {
    headers['Cookie'] = `JSESSIONID=${cookie}`;
  }

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      clg_no: '14581',
      cls_no: '0',
      p_pageno: '1',
      check_fa_test: '1001',
      stu_name: '유지연',
      sort_date1: '2026-09-14',
      sort_date2: '2026-09-28',
      checkAllPage: 'Y'
    }).toString()
  });

  const html = await res.text();
  console.log(`Response length: ${html.length} bytes`);

  const analysis = engine.analyzeHtml(html, 'TestPageListServlet');

  console.log(`\n[Discovered External Scripts (${analysis.scripts.length} files)]:`);
  for (const s of analysis.scripts) {
    console.log(`  • ${s}`);
  }

  console.log(`\n[Discovered Servlet Endpoints (${analysis.endpoints.length} routes)]:`);
  for (const ep of analysis.endpoints.slice(0, 10)) {
    console.log(`  • [${ep.method || 'ANY'}] ${ep.url}`);
  }

  console.log(`\n[Key Client Functions (${analysis.functions.length} found)]:`);
  const keyFuncs = analysis.functions.filter(f => f.name.includes('Clinic') || f.name.includes('Paper') || f.name.includes('Test') || f.name.includes('Print'));
  for (const f of keyFuncs) {
    console.log(`  • ${f.name}(${f.params.join(', ')})`);
  }

  const reportDir = join(__dirname, '..', 'docs');
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'LMS_REVERSE_ENGINEERING_REPORT.json');
  writeFileSync(reportPath, JSON.stringify(analysis, null, 2), 'utf-8');
  console.log(`\n[SUCCESS] Detailed Reverse Engineering Report saved to: ${reportPath}\n`);
}

if (import.meta.main) {
  main().catch(err => {
    console.error('Fatal execution error:', err.message);
    process.exit(1);
  });
}
