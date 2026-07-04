/* Test-only helpers (not part of the public API). */

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export type MockFetch = typeof fetch & { calls: RecordedCall[] };

/** Build an injectable fetch that records calls and delegates to `handler`. */
export function makeFetch(
  handler: (call: RecordedCall) => Response | Promise<Response>,
): MockFetch {
  const calls: RecordedCall[] = [];
  const fn = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: RecordedCall = { url, init: init ?? {} };
    calls.push(call);
    return handler(call);
  };
  (fn as unknown as { calls: RecordedCall[] }).calls = calls;
  return fn as unknown as MockFetch;
}

/** A mock fetch that always returns the given JSON body/status. */
export function jsonFetch(body: unknown, status = 200): MockFetch {
  return makeFetch(() => jsonResponse(body, status));
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

/** Read the Authorization header from a recorded call, if any. */
export function authHeader(call: RecordedCall): string | undefined {
  const h = call.init.headers as Record<string, string> | undefined;
  return h?.Authorization ?? h?.authorization;
}

/** Extract the multipart field names from a recorded FormData body. */
export async function formFieldNames(call: RecordedCall): Promise<string[]> {
  const body = call.init.body;
  if (!(body instanceof FormData)) {
    throw new Error('recorded body is not FormData');
  }
  const names: string[] = [];
  body.forEach((_value, key) => names.push(key));
  return names;
}
