/**
 * IOsense REST base wrapper.
 *
 * Every call to `connector.iosense.io` goes through `request()` so the auth
 * header, the organisation context and the `{ success, data }` envelope are
 * handled in exactly one place.
 */

export const BASE_URL = 'https://connector.iosense.io/api';

/* The portal the SSO token is minted against. Sent on the token exchange and
   on any call that needs organisation context. */
export const ORGANISATION_URL = 'https://iosense.io';

/* Where the JWT lives between reloads. The platform-wide key — do not rename:
   other IOsense surfaces read the same one. */
export const TOKEN_KEY = 'bearer_token';
const ORG_KEY = 'iosense_organisation';

/** Thrown for any non-2xx response or an envelope with `success: false`. */
export class ApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    /* 401/403 mean the JWT is gone or rejected: the caller should send the
       reader back to the portal rather than retry. */
    this.isAuthFailure = status === 401 || status === 403;
  }
}

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      /* Private mode / blocked storage — run tokenless rather than crash. */
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/**
 * The stored JWT, already prefixed `Bearer ` by `validateSSOToken`.
 * Never concatenate `'Bearer ' + token` on top of this.
 */
export const getToken = () => storage.get(TOKEN_KEY) || '';
export const setToken = (token) => storage.set(TOKEN_KEY, token);
export const clearToken = () => {
  storage.remove(TOKEN_KEY);
  storage.remove(ORG_KEY);
};

export const getOrganisation = () => storage.get(ORG_KEY) || ORGANISATION_URL;
export const setOrganisation = (org) => org && storage.set(ORG_KEY, org);

/**
 * One HTTP call against the IOsense connector.
 *
 * @param {string} path      Path below `BASE_URL`, with a leading slash.
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {object} [options.body]     JSON-serialised when present.
 * @param {boolean} [options.auth=true]  Send the Authorization header.
 * @param {boolean|string} [options.organisation=false] Send the organisation
 *   header — `true` for the stored organisation context, or an explicit value
 *   (the SSO exchange must send the portal URL, not an org id).
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} The parsed envelope.
 */
export async function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    auth = true,
    organisation = false,
    signal,
  } = options;

  const headers = { 'Content-Type': 'application/json', 'ngsw-bypass': 'true' };

  if (auth) {
    const token = getToken();
    if (!token) throw new ApiError('Not authenticated', { status: 401 });
    headers.Authorization = token;
  }
  if (organisation) {
    headers.organisation =
      typeof organisation === 'string' ? organisation : getOrganisation();
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(`Network error contacting IOsense: ${err.message}`);
  }

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    /* Non-JSON body — surfaced through the status check below. */
  }

  if (!res.ok) {
    throw new ApiError(
      (payload && (payload.message || payload.error)) ||
        `IOsense request failed (${res.status})`,
      { status: res.status, body: payload }
    );
  }
  if (payload && payload.success === false) {
    const errors = Array.isArray(payload.errors) ? payload.errors.join(', ') : '';
    throw new ApiError(errors || 'IOsense request was unsuccessful', {
      status: res.status,
      body: payload,
    });
  }
  return payload;
}
