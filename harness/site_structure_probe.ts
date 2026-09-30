import { resolve } from "node:path";
import { getStudentById } from "../src/canonical/canonicalEntities";

type RouteEntry = {
  id: string;
  route_template: string;
  http_method: string;
  semantic_effect: string;
  safe_to_probe: boolean;
};

type Registry = { entries: RouteEntry[] };

const allowedRoutes = new Set(["prestudy_waiting", "prestudy_completed", "textbook_answer_catalog"]);
const baseUrl = "https://dc.gang-a.kr";
const maxBytes = 2_000_000;

function attributeNames(html: string, tag: string): string[] {
  const names = new Set<string>();
  const tags = html.match(new RegExp(`<${tag}\\b[^>]*>`, "gi")) ?? [];
  for (const element of tags) {
    const match = element.match(/\bname\s*=\s*["']([^"']+)["']/i);
    if (match && /^[a-zA-Z_][\w.-]*$/.test(match[1])) names.add(match[1]);
  }
  return [...names].sort();
}

function textOnly(fragment: string): string {
  return fragment
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function rowShape(html: string, studentId?: string) {
  const student = studentId ? getStudentById(studentId) : null;
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const headerLabels = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((match) => textOnly(match[1]).slice(0, 80))
    .filter(Boolean);
  const targetMatches = student ? rows.flatMap((row, index) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => textOnly(match[1]));
    const nameIndex = cells.findIndex((cell) => cell === student.name);
    if (nameIndex < 0) return [];
    const following = nameIndex >= 0 ? cells.slice(nameIndex + 1, nameIndex + 4) : [];
    const dateLooksValid = /^\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}$/.test(following[1] ?? "");
    return [{
      rowIndex: index,
      cellCount: cells.length,
      canonicalIdPresent: row.includes(student.studentId),
      identityBinding: row.includes(student.studentId) ? "canonical_id_in_row" : "display_name_only",
      evidence: dateLooksValid && following[0] && following[0].length <= 120 ? {
        unitTitle: following[0],
        timestamp: following[1],
        displayedState: (following[2] ?? "").slice(0, 40),
      } : null,
    }];
  }) : [];
  return { headerLabels, targetMatches };
}

function relevantSampleNames(html: string) {
  const names = new Map<string, { name: string; host: string; pathPrefix: string; hasQuery: boolean }>();
  for (const match of html.matchAll(/fullUrlDownloadFile\(['"](https?:\/\/[^'"]+)['"]\)/gi)) {
    try {
      const url = new URL(match[1]);
      const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (/^g(?:6|7)_[a-z]+_sample(?:_\d+_\d+)?\.pdf$/i.test(name)) {
        names.set(name, {
          name,
          host: url.host,
          pathPrefix: url.pathname.slice(0, -name.length),
          hasQuery: Boolean(url.search),
        });
      }
    } catch {
      // Malformed catalog links do not become download candidates.
    }
  }
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function activeCatalogTab(html: string): string | null {
  const match = html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\btab-on\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  return match ? textOnly(match[1]).slice(0, 40) : null;
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function main(): Promise<void> {
  const routeId = process.argv[2];
  const studentId = process.argv[3];
  if (!routeId || !allowedRoutes.has(routeId)) throw new Error("route_not_allowlisted");
  if (studentId && !/^\d{7}$/.test(studentId)) throw new Error("invalid_student_id");
  const registryPath = resolve(import.meta.dir, "../research/backend-map/route-registry.json");
  const registry = (await Bun.file(registryPath).json()) as Registry;
  const matches = registry.entries.filter((entry) => entry.id === routeId);
  if (matches.length !== 1) throw new Error("route_not_registered");
  const route = matches[0];
  if (route.http_method !== "GET" || route.semantic_effect !== "read" || !route.safe_to_probe) {
    throw new Error("route_not_approved_read");
  }
  const url = new URL(route.route_template, baseUrl);
  if (url.origin !== baseUrl || !url.pathname.startsWith("/servlet/")) {
    throw new Error("route_outside_academy_servlet");
  }
  const session = (await Bun.stdin.text()).trim();
  if (!/^[A-Fa-f0-9]{32}$/.test(session)) throw new Error("invalid_session_input");
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { Cookie: `JSESSIONID=${session}`, Accept: "text/html" },
  });
  if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/html") {
    throw new Error("unexpected_response_contract");
  }
  const html = await readBounded(response);
  if (/<input\b[^>]*type\s*=\s*["']password["']/i.test(html)) {
    throw new Error("authentication_page_returned");
  }
  const output = {
    routeId,
    readAt: new Date().toISOString(),
    httpStatus: response.status,
    contentType: response.headers.get("content-type")?.split(";")[0] ?? null,
    responseBytes: new TextEncoder().encode(html).byteLength,
    structure: {
      formCount: (html.match(/<form\b/gi) ?? []).length,
      tableCount: (html.match(/<table\b/gi) ?? []).length,
      rowCount: (html.match(/<tr\b/gi) ?? []).length,
      inputNames: attributeNames(html, "input"),
      selectNames: attributeNames(html, "select"),
      samplePdfControlCount: (html.match(/fullUrlDownloadFile\s*\(/gi) ?? []).length,
      pdfReferenceCount: (html.match(/\.pdf\b/gi) ?? []).length,
      passwordFieldPresent: /<input\b[^>]*type\s*=\s*["']password["']/i.test(html),
      relevantSampleNames: routeId === "textbook_answer_catalog" ? relevantSampleNames(html) : [],
      activeCatalogTab: routeId === "textbook_answer_catalog" ? activeCatalogTab(html) : null,
      ...rowShape(html, studentId),
    },
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}

try {
  await main();
} catch (error: unknown) {
  const code = error instanceof Error ? error.message : "unknown_error";
  process.stderr.write(JSON.stringify({ status: "blocked", reason: code }) + "\n");
  process.exitCode = 1;
}
