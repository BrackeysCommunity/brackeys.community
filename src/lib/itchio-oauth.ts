import { env } from "@/env";
import { toast } from "@/lib/toast";

/**
 * itch.io implicit-flow OAuth helpers, shared by the profile "connect"
 * surfaces and the callback route.
 *
 * `state` is both the CSRF nonce and the preview-environment forwarding
 * target: production flows carry a bare nonce, preview flows carry
 * `nonce|origin` so the registered production callback can bounce the
 * token back to the preview that initiated. `|` never appears in a UUID
 * or an origin, so the split is unambiguous. The nonce is stored in
 * sessionStorage on the initiating origin and checked (single-use) when
 * the callback lands back there — a callback whose state doesn't match
 * a nonce this session created is not acted on.
 */

const NONCE_STORAGE_KEY = "itchio:oauth:nonce";

export function buildOAuthState(
  currentOrigin: string,
  productionOrigin: string | undefined,
): string {
  const nonce = crypto.randomUUID();
  sessionStorage.setItem(NONCE_STORAGE_KEY, nonce);
  const isPreview = Boolean(productionOrigin) && currentOrigin !== productionOrigin;
  return isPreview ? `${nonce}|${currentOrigin}` : nonce;
}

export function parseOAuthState(state: string | null): {
  nonce: string | null;
  origin: string | null;
} {
  if (!state) return { nonce: null, origin: null };
  const sep = state.indexOf("|");
  if (sep === -1) return { nonce: state, origin: null };
  return { nonce: state.slice(0, sep) || null, origin: state.slice(sep + 1) || null };
}

/** Read and clear the stored nonce — single-use by design. */
export function consumeStoredNonce(): string | null {
  const nonce = sessionStorage.getItem(NONCE_STORAGE_KEY);
  sessionStorage.removeItem(NONCE_STORAGE_KEY);
  return nonce;
}

/**
 * Allowlist for the production callback's preview bounce: Railway preview
 * envs over https, or localhost/127.0.0.1 over http. Origin strings only —
 * anything carrying a path, query, or hash fails the `url.origin` echo
 * check, which also kills lookalike hosts (`x.up.railway.app.evil.com`).
 */
export function isAllowedPreviewOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.protocol === "https:") return url.hostname.endsWith(".up.railway.app");
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return false;
}

/**
 * The bounce forwards the full original state, not just the token — the
 * preview callback still has to pass its own nonce check.
 */
export function buildPreviewBounceUrl(origin: string, accessToken: string, state: string): string {
  const hash = new URLSearchParams({ access_token: accessToken, state }).toString();
  return `${origin}/oauth/itchio/callback#${hash}`;
}

export function startItchOAuth(): void {
  const clientId = env.VITE_ITCHIO_CLIENT_ID;
  if (!clientId) {
    toast.error("itch.io integration is not configured");
    return;
  }
  // Preview envs can't be registered as itch redirect URIs, so they send
  // the flow through the registered production callback, which bounces
  // back using the origin carried in `state`.
  const productionOrigin = env.VITE_OAUTH_PROXY_ORIGIN;
  const currentOrigin = window.location.origin;
  const isPreview = Boolean(productionOrigin) && currentOrigin !== productionOrigin;
  const redirectUri = isPreview
    ? `${productionOrigin}/oauth/itchio/callback`
    : `${currentOrigin}/oauth/itchio/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "profile:me profile:games",
    response_type: "token",
    redirect_uri: redirectUri,
    state: buildOAuthState(currentOrigin, productionOrigin),
  });
  window.location.href = `https://itch.io/user/oauth?${params.toString()}`;
}
