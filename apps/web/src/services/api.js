/**
 * HTTP client for the FraudLens API.
 *
 * Responsibilities kept deliberately in one place:
 *  - sends the session cookie on every request (`credentials: 'include'`);
 *  - attaches the CSRF token to every state-changing request;
 *  - unwraps the `{ data, meta }` envelope so callers deal in plain values;
 *  - turns an error envelope into a typed `ApiError` carrying the field-level
 *    validation details, which is what lets forms show errors per input.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';
const CSRF_COOKIE = 'fraudlens_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export class ApiError extends Error {
  constructor(message, { status, code, details, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** True when the session is gone and the user must sign in again. */
  get isUnauthenticated() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isNotFound() {
    return this.status === 404;
  }

  /** Maps validation details to `{ field: message }` for react-hook-form. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return this.details.reduce((accumulator, issue) => {
      if (issue.field && !accumulator[issue.field]) {
        accumulator[issue.field] = issue.message;
      }
      return accumulator;
    }, {});
  }
}

/**
 * Reads the CSRF token the server set as a readable cookie.
 *
 * The session cookie itself is httpOnly and never readable here, which is the
 * point: this value is useless without it.
 */
export function readCsrfToken() {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Serialises a params object into a query string, dropping empty values. */
export function toQueryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      // Repeated keys, which the Zod query schemas accept as an array.
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') search.append(key, String(item));
      }
    } else if (value instanceof Date) {
      search.set(key, value.toISOString());
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Subscribers notified when the API reports an expired or invalid session, so
 * the auth context can clear state without this module importing React.
 */
const unauthenticatedHandlers = new Set();

export function onUnauthenticated(handler) {
  unauthenticatedHandlers.add(handler);
  return () => unauthenticatedHandlers.delete(handler);
}

async function parseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Performs one API request.
 *
 * @param {string} path Path below `/api/v1`, e.g. `/transactions`.
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body] JSON body for unsafe methods.
 * @param {object} [options.params] Query parameters.
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.raw] Return the Response instead of unwrapping.
 * @param {boolean} [options.envelope] False for endpoints that return a bare
 *   body rather than the `{ data, meta }` envelope — `/health` does, because a
 *   container orchestrator probing it expects a flat document.
 */
export async function request(
  path,
  { method = 'GET', body, params, signal, raw = false, envelope = true } = {},
) {
  const headers = { Accept: 'application/json' };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (UNSAFE_METHODS.has(method)) {
    const token = readCsrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}${toQueryString(params)}`, {
      method,
      headers,
      // Sends and accepts the httpOnly session cookie.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // A network-level failure, not an API error: the server was never reached.
    throw new ApiError('Could not reach the FraudLens API. Check your connection.', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  if (raw) return response;

  const payload = await parseBody(response);

  if (!response.ok) {
    const error = new ApiError(
      payload?.error?.message ?? `Request failed with status ${response.status}`,
      {
        status: response.status,
        code: payload?.error?.code,
        details: payload?.error?.details,
        requestId: payload?.error?.requestId ?? response.headers.get('x-request-id'),
      },
    );
    // A 401 on any request means the session is no longer usable. Notifying
    // here, centrally, is what makes an expired session log the user out
    // wherever they happen to be rather than leaving a broken page.
    if (error.status === 401) {
      for (const handler of unauthenticatedHandlers) handler(error);
    }
    throw error;
  }

  if (!envelope) {
    return { data: payload, meta: null };
  }
  return { data: payload?.data ?? null, meta: payload?.meta ?? null };
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  /** GET for an endpoint whose response is not wrapped in the data envelope. */
  getBare: (path, options) => request(path, { ...options, method: 'GET', envelope: false }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  /** Fetches a CSV export and triggers a browser download. */
  async download(path, params) {
    const response = await request(path, { params, raw: true });
    if (!response.ok) {
      const payload = await parseBody(response);
      throw new ApiError(payload?.error?.message ?? 'Export failed', {
        status: response.status,
        code: payload?.error?.code,
      });
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match?.[1] ?? 'fraudlens-export.csv';

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Released on the next tick so the click has been handled.
    setTimeout(() => URL.revokeObjectURL(url), 0);

    return { filename, rowCount: Number(response.headers.get('x-row-count') ?? 0) };
  },
};

export { API_BASE, CSRF_HEADER };
