import { describe, expect, it } from 'bun:test';
import { discoverSamplePdfUrl, resolveGaussSamplePdfUrl } from '../../src/lms/textbookSamplePdf';

const session = 'a'.repeat(32);
const prefix = 'https://storage.studyq.net/data/answer/mi/book/';

function catalogFetch(html: string, status = 200, contentType = 'text/html'): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('https://dc.gang-a.kr/servlet/controller.coursemanage.CourseManageServlet?reqCmd=GaStudyAnswer');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect((init?.headers as Record<string, string>).Cookie).toBe(`JSESSIONID=${session}`);
    return new Response(html, { status, headers: { 'content-type': contentType } });
  }) as typeof fetch;
}

describe('catalog-scoped sample PDF discovery', () => {
  it('resolves a future book only from its matching authenticated catalog link', async () => {
    const filename = 'g8_gauss_sample_1_2.pdf';
    const html = `<button onclick="fullUrlDownloadFile('${prefix}${filename}')">sample</button>`;
    expect(await discoverSamplePdfUrl('gauss:2-1-2', session, catalogFetch(html)))
      .toBe(`${prefix}${filename}`);
  });

  it('keeps the two observed exact links compatible', () => {
    expect(resolveGaussSamplePdfUrl('g7_gauss_sample_1_1.pdf')).toBe(`${prefix}g7_gauss_sample_1_1.pdf`);
    expect(resolveGaussSamplePdfUrl('g7_gauss_sample_2_3.pdf')).toBe(`${prefix}g7_gauss_sample_2_3.pdf`);
    expect(() => resolveGaussSamplePdfUrl('g7_gauss_sample_1_2.pdf' as any)).toThrow();
  });

  it('rejects absent, adjacent, wrong-host, and query-bearing links', async () => {
    const target = 'g8_gauss_sample_1_2.pdf';
    for (const url of [
      `${prefix}g8_gauss_sample_1_3.pdf`,
      `https://example.com/data/answer/mi/book/${target}`,
      `${prefix}${target}?download=1`,
      `https://storage.studyq.net/data/answer/hi/book/${target}`,
    ]) {
      await expect(discoverSamplePdfUrl('gauss:2-1-2', session,
        catalogFetch(`<button onclick="fullUrlDownloadFile('${url}')">sample</button>`)))
        .rejects.toThrow();
    }
  });

  it('rejects unscoped book codes and unauthenticated responses', async () => {
    const html = `<button onclick="fullUrlDownloadFile('${prefix}g8_gauss_sample_1_2.pdf')">sample</button>`;
    await expect(discoverSamplePdfUrl('davinci:6-2-1', session, catalogFetch(html))).rejects.toThrow();
    await expect(discoverSamplePdfUrl('gauss:2-1-2', 'bad', catalogFetch(html))).rejects.toThrow();
    await expect(discoverSamplePdfUrl('gauss:2-1-2', session, catalogFetch(html, 302))).rejects.toThrow();
    await expect(discoverSamplePdfUrl('gauss:2-1-2', session, catalogFetch(html, 200, 'application/json'))).rejects.toThrow();
    await expect(discoverSamplePdfUrl('gauss:2-1-2', session,
      catalogFetch('<input type="password">' + html))).rejects.toThrow();
  });
});
