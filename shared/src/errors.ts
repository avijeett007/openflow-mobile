/**
 * Typed error hierarchy for the OpenFlow shared core.
 *
 * These are thrown by the STT and cleanup clients so the caller can decide how
 * to react (retry, insert the raw transcript, surface an auth prompt, ...).
 * Nothing here is ever swallowed — the caller owns the fallback policy.
 */

/** Base class for every error raised by `@openflow/shared`. */
export class OpenFlowError extends Error {
  constructor(message: string) {
    super(message);
    // Preserve the concrete subclass name (AuthError, EndpointError, ...).
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The provider rejected the credentials (HTTP 401 / 403). */
export class AuthError extends OpenFlowError {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * The endpoint returned a non-OK, non-auth status, or a response we could not
 * parse. `bodySnippet` holds up to the first 500 chars of the response body to
 * aid debugging without dumping huge payloads.
 */
export class EndpointError extends OpenFlowError {
  readonly status: number;
  readonly bodySnippet: string;
  constructor(message: string, status: number, bodySnippet = '') {
    super(message);
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

/** The provided settings are invalid or incomplete (e.g. custom without baseUrl). */
export class ConfigError extends OpenFlowError {}

const SNIPPET_MAX = 500;

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Convert a failed `Response` into the appropriate typed error and throw it.
 * 401/403 become {@link AuthError}; everything else becomes {@link EndpointError}.
 */
export async function throwForResponse(res: Response, context: string): Promise<never> {
  const body = await safeText(res);
  const snippet = body.slice(0, SNIPPET_MAX);
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`${context}: authentication failed (HTTP ${res.status})`, res.status);
  }
  throw new EndpointError(`${context}: request failed (HTTP ${res.status})`, res.status, snippet);
}
