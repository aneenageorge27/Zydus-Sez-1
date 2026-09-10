/**
 * SSO → JWT.
 *
 * The reader arrives from the IOsense portal with `?token=xxx` on the URL.
 * That SSO token is one-time use and dies 60 seconds after it is minted, so it
 * is exchanged once for a Bearer JWT, the JWT is stored, and the token is
 * stripped from the address bar before it can be copied or re-sent.
 *
 * functionId: validateSSOToken
 */

import {
  ApiError,
  ORGANISATION_URL,
  clearToken,
  getToken,
  request,
  setOrganisation,
  setToken,
} from './api.js';

export const PORTAL_URL = 'https://iosense.io';

/**
 * Exchange a one-time SSO token for a Bearer JWT.
 * @param {string} ssoToken
 * @returns {Promise<{token: string, organisation: string, userId: string}>}
 */
export async function validateSSOToken(ssoToken) {
  /* No Authorization header yet — this call is what mints it. The organisation
     header is the portal URL, sent explicitly so a stale org id left in storage
     by a previous session cannot leak into the exchange. */
  const payload = await request(
    `/retrieve-sso-token/${encodeURIComponent(ssoToken)}`,
    { method: 'GET', auth: false, organisation: ORGANISATION_URL }
  );

  if (!payload || !payload.token) {
    throw new ApiError('SSO exchange returned no token', { body: payload });
  }
  return payload;
}

/** Take `?token=` off the URL without adding a history entry. */
function stripTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  window.history.replaceState({}, '', url.toString());
}

/**
 * Resolve a usable JWT.
 *
 * Order: a fresh `?token=` on the URL always wins (the reader just came from
 * the portal), then whatever is already in localStorage.
 *
 * @returns {Promise<{token: string, source: 'sso'|'stored'|'none'}>}
 */
export async function ensureAuth() {
  const url = new URL(window.location.href);
  const ssoToken = url.searchParams.get('token');

  if (ssoToken) {
    try {
      const result = await validateSSOToken(ssoToken);
      setToken(result.token);
      setOrganisation(result.organisation || ORGANISATION_URL);
      return { token: result.token, source: 'sso' };
    } finally {
      /* Strip it either way: the token is spent even on a failed exchange, so
         leaving it on the URL only invites a pointless retry on reload. */
      stripTokenFromUrl();
    }
  }

  const stored = getToken();
  if (stored) return { token: stored, source: 'stored' };
  return { token: '', source: 'none' };
}

/**
 * Drop the stored JWT. Called when the connector rejects it — there is no
 * refresh path, so the reader has to mint a new SSO token from the portal.
 */
export function signOut() {
  clearToken();
}
