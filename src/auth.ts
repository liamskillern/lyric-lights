// Spotify login with Authorization Code + PKCE.
// PKCE lets a browser-only app log in without a client secret, so there is no
// backend and no secret to leak. Tokens stay in this browser's localStorage.

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = ["user-read-currently-playing", "user-read-playback-state"];

const KEY_CLIENT_ID = "sv.clientId";
const KEY_TOKENS = "sv.tokens";
const KEY_VERIFIER = "sv.pkce.verifier";
const KEY_STATE = "sv.pkce.state";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token stops working */
  expiresAt: number;
}

// ---------- PKCE helpers (pure, tested) ----------

const VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** Random string from the PKCE "unreserved" alphabet (RFC 7636 §4.1). */
export function randomString(length = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 66 chars: modulo bias is tiny and irrelevant at this length of randomness.
  return Array.from(bytes, (b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length]).join("");
}

export function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256 code challenge for a verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(digest);
}

// ---------- config ----------

/** The page URL Spotify sends the user back to. Must be listed in the Spotify dashboard. */
export function redirectUri(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

export function getClientId(): string | null {
  const fromBuild = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
  if (fromBuild && fromBuild.trim()) return fromBuild.trim();
  return safeGet(KEY_CLIENT_ID);
}

export function setClientId(id: string): void {
  safeSet(KEY_CLIENT_ID, id.trim());
}

export function isValidClientId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id.trim());
}

// ---------- login flow ----------

export async function beginLogin(clientId: string): Promise<void> {
  const verifier = randomString(64);
  const state = randomString(24);
  safeSet(KEY_VERIFIER, verifier);
  safeSet(KEY_STATE, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: await codeChallenge(verifier),
    scope: SCOPES.join(" "),
    state,
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

export type RedirectResult =
  | { kind: "none" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

/**
 * If Spotify just sent us back with ?code=…, trade it for tokens.
 * Always strips the auth params from the address bar afterwards.
 */
export async function handleRedirect(clientId: string): Promise<RedirectResult> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  if (!code && !error) return { kind: "none" };

  const cleanUrl = url.pathname + (url.searchParams.has("demo") ? "?demo" : "") + url.hash;
  window.history.replaceState(null, "", cleanUrl);

  const expectedState = safeGet(KEY_STATE);
  const verifier = safeGet(KEY_VERIFIER);
  safeRemove(KEY_STATE);
  safeRemove(KEY_VERIFIER);

  if (error) {
    return { kind: "error", message: error === "access_denied" ? "Login was cancelled." : `Spotify said: ${error}` };
  }
  // The state check stops another site from completing a login into this page (CSRF).
  if (!state || !expectedState || state !== expectedState) {
    return { kind: "error", message: "Login check failed (state mismatch). Please try again." };
  }
  if (!verifier) {
    return { kind: "error", message: "Login expired. Please try again." };
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    return { kind: "error", message: `Couldn't finish login (${res.status}). ${await describeTokenError(res)}` };
  }
  saveTokens(tokensFromResponse(await res.json()));
  return { kind: "ok" };
}

// ---------- tokens ----------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export function tokensFromResponse(json: TokenResponse, previousRefresh?: string, now = Date.now()): Tokens {
  return {
    accessToken: json.access_token,
    // Spotify may or may not rotate the refresh token; keep the old one if not.
    refreshToken: json.refresh_token ?? previousRefresh ?? "",
    expiresAt: now + json.expires_in * 1000,
  };
}

export function loadTokens(): Tokens | null {
  const raw = safeGet(KEY_TOKENS);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Tokens;
    return t.accessToken && t.refreshToken ? t : null;
  } catch {
    return null;
  }
}

function saveTokens(t: Tokens): void {
  safeSet(KEY_TOKENS, JSON.stringify(t));
}

export function isLoggedIn(): boolean {
  return loadTokens() !== null;
}

export function logout(): void {
  safeRemove(KEY_TOKENS);
}

let refreshing: Promise<Tokens | null> | null = null;

/** A working access token, refreshed if it's about to expire. Null means log in again. */
export async function getAccessToken(clientId: string): Promise<string | null> {
  const t = loadTokens();
  if (!t) return null;
  if (t.expiresAt - Date.now() > 60_000) return t.accessToken;

  // Several callers may ask at once; only refresh once.
  refreshing ??= refresh(clientId, t).finally(() => {
    refreshing = null;
  });
  const fresh = await refreshing;
  return fresh?.accessToken ?? null;
}

/** Force a refresh (used after a 401). */
export async function forceRefresh(clientId: string): Promise<string | null> {
  const t = loadTokens();
  if (!t) return null;
  saveTokens({ ...t, expiresAt: 0 });
  return getAccessToken(clientId);
}

async function refresh(clientId: string, t: Tokens): Promise<Tokens | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: t.refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    // 400 invalid_grant = refresh token revoked or expired: log out.
    if (res.status === 400 || res.status === 401) logout();
    return null;
  }
  const fresh = tokensFromResponse(await res.json(), t.refreshToken);
  saveTokens(fresh);
  return fresh;
}

async function describeTokenError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; error_description?: string };
    if (j.error_description?.includes("redirect")) {
      return `Check that ${redirectUri()} is listed as a Redirect URI in your Spotify app.`;
    }
    return j.error_description ?? j.error ?? "";
  } catch {
    return "";
  }
}

// ---------- storage that never throws (private windows, blocked storage) ----------

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: login won't persist, app still works this tab */
  }
}
function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
