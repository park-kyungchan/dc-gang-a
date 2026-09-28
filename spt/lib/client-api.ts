/** Client JSON transport. No retries: callers own uncertain-effect recovery.
 * Preserve the existing response/error contract; validation belongs to each
 * endpoint consumer rather than the classroom navigation component.
 */
export async function post<T = unknown>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({error: '서버 응답을 확인하지 못했습니다.'}));
  if (!response.ok) throw new Error((data as {error?: string}).error || '처리하지 못했습니다.');
  // A caller's type argument describes its endpoint contract; it is not runtime
  // schema validation and does not reinterpret legacy malformed-200 responses.
  return data as T;
}
