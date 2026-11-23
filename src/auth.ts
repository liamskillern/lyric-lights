// Spotify login with Authorization Code + PKCE.
// PKCE lets a browser-only app log in without a client secret, so there is no
// backend and no secret to leak.
//
// Token storage (see storage.ts for why): the access token lives only in memory, the
// refresh token in sessionStorage (this tab only). Reloading the tab keeps you logged in;
// closing it logs you out, and reconnecting is one click because Spotify remembers you.

import { local, session } from "./storage";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = ["user-read-currently-playing", "user-read-playback-state"];

const KEY_CLIENT_ID = "sv.clientId";
const KEY_REFRESH = "sv.refresh";
/** Refresh token kept across restarts: wallpaper mode only (see setRememberLogin). */
const KEY_REFRESH_KEPT = "sv.wallpaper.refresh";
const KEY_VERIFIER = "sv.pkce.verifier";
const KEY_STATE = "sv.pkce.state";
/** Where v0.1 kept tokens (localStorage). Deleted on load. */
const LEGACY_KEY_TOKENS = "sv.tokens";

/** Where people can cut this app off from their Spotify account. */
export const REVOKE_URL = "https://www.spotify.com/account/apps/";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token stops working */
  expiresAt: number;
}

// ---------- PKCE helpers (pure, tested) ----------

const VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/**
 * Random string from the PKCE "unreserved" alphabet (RFC 7636 §4.1).
 * Rejection sampling keeps every character equally likely (no modulo bias).
 */
export function randomString(length = 64): string {
  const n = VERIFIER_CHARS.length; // 66
  const limit = 256 - (256 % n); // 198: bytes at or above this would favor some characters
  let out = "";
  while (out.length < length) {
    // getRandomValues allows at most 65,536 bytes per call, so ask in chunks.
    const chunk = Math.min(4096, (length - out.length) * 2);
    for (const b of crypto.getRandomValues(new Uint8Array(chunk))) {
      if (b < limit) out += VERIFIER_CHARS[b % n];
      if (out.length === length) break;
    }
  }
  return out;
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

// ---------- error messages (fixed text only) ----------

/**
 * Turn an `?error=` code from the address bar into a message. Anyone can put any text in a
 * link, so we never show the raw value: only known codes get specific wording.
 */
export function loginErrorMessage(code: string | null): string {
  switch (code) {
    case "access_denied":
      return "Login was cancelled.";
    case "invalid_client":
      return "Spotify didn't recognize the Client ID. Check it in your Spotify app's settings.";
    case "server_error":
    case "temporarily_unavailable":
      return "Spotify had a problem. Please try again in a minute.";
    default:
      return "Login failed. Please try again.";
  }
}

/** Should a failed token refresh log you out (true) or just be retried later (false)? */
export function refreshFailureIsFinal(status: number): boolean {
  // 400 = invalid_grant (token revoked/expired) or invalid_client; 401 = bad client.
  // 429 and 5xx are Spotify being busy or down: keep the login and try again.
  return status === 400 || status === 401;
}

// ---------- config ----------

/** The page URL Spotify sends the user back to. Must be listed in the Spotify dashboard. */
export function redirectUri(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

export function getClientId(): string | null {
  const fromBuild = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
  if (fromBuild && fromBuild.trim()) return fromBuild.trim();
  return local.get(KEY_CLIENT_ID);
}

export function setClientId(id: string): void {
  local.set(KEY_CLIENT_ID, id.trim());
}

export function isValidClientId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id.trim());
}

// ---------- login flow ----------

export async function beginLogin(clientId: string): Promise<void> {
  const verifier = randomString(64);
  const state = randomString(32);
  // The redirect comes back to this same tab, so sessionStorage is enough.
  session.set(KEY_VERIFIER, verifier);
  session.set(KEY_STATE, state);

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
  /** pairing login (see wallpaper.ts): the refresh token to hand over, not saved here */
  | { kind: "paired"; refreshToken: string }
  | { kind: "error"; message: string };

/**
 * If Spotify just sent us back with ?code=…, trade it for tokens.
 * Always strips the auth params from the address bar afterwards.
 */
export async function handleRedirect(clientId: string, opts: { pairing?: boolean } = {}): Promise<RedirectResult> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  if (!code && !error) return { kind: "none" };

  window.history.replaceState(null, "", url.pathname + url.hash);

  const expectedState = session.get(KEY_STATE);
  const verifier = session.get(KEY_VERIFIER);
  session.remove(KEY_STATE);
  session.remove(KEY_VERIFIER);

  if (error) return { kind: "error", message: loginErrorMessage(error) };
  // The state check stops another site from completing a login into this page (CSRF).
  if (!state || !expectedState || state !== expectedState) {
    return { kind: "error", message: "Login check failed. Please try again." };
  }
  if (!verifier) return { kind: "error", message: "Login expired. Please try again." };

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
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
  } catch {
    return { kind: "error", message: "Can't reach Spotify. Check your connection and try again." };
  }
  if (!res.ok) return { kind: "error", message: await describeTokenError(res) };
  const tokens = tokensFromResponse(await res.json());
  if (opts.pairing) {
    // A login made only to hand to a wallpaper: nothing is kept in this browser.
    if (!tokens.refreshToken) return { kind: "error", message: "Spotify didn't send a pairing code. Please try again." };
    return { kind: "paired", refreshToken: tokens.refreshToken };
  }
  saveTokens(tokens);
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
    // Spotify usually rotates the refresh token; keep the old one if it doesn't.
    refreshToken: json.refresh_token ?? previousRefresh ?? "",
    expiresAt: now + json.expires_in * 1000,
  };
}

/** Access token in memory only: gone on reload, re-fetched with the refresh token. */
let memory: { accessToken: string; expiresAt: number } | null = null;

/**
 * Wallpaper mode only: keep the refresh token in localStorage so the login survives reboots.
 * A desktop wallpaper app (Lively) runs its own browser profile, so the storage area shared by
 * every *.github.io site there holds only what you load as wallpapers. The normal app never
 * reads or writes this key.
 */
let remember = false;
export function setRememberLogin(on: boolean): void {
  remember = on;
}

function refreshStore() {
  return remember ? { s: local, key: KEY_REFRESH_KEPT } : { s: session, key: KEY_REFRESH };
}

function saveTokens(t: Tokens): void {
  memory = { accessToken: t.accessToken, expiresAt: t.expiresAt };
  const { s, key } = refreshStore();
  if (t.refreshToken) s.set(key, t.refreshToken);
}

/** Does this look like a Spotify refresh token (a pairing code)? Pure; tested. */
export function isValidPairCode(code: string): boolean {
  return /^[A-Za-z0-9_~.-]{40,1000}$/.test(code.trim());
}

/**
 * Wallpaper mode only: log in with a pairing code (a refresh token made by `?pair` in a normal
 * browser), for wallpaper apps that can't take keyboard input. Returns false if refused.
 */
export function importRefreshToken(code: string): boolean {
  if (!remember || !isValidPairCode(code)) return false;
  memory = null;
  local.set(KEY_REFRESH_KEPT, code.trim());
  return true;
}

/** Delete tokens that older versions left in localStorage. Safe to call any time. */
export function removeLegacyTokens(): void {
  local.remove(LEGACY_KEY_TOKENS);
}

export function isLoggedIn(): boolean {
  const { s, key } = refreshStore();
  return memory !== null || s.get(key) !== null;
}

export function logout(): void {
  memory = null;
  session.remove(KEY_REFRESH);
  local.remove(KEY_REFRESH_KEPT);
  session.remove(KEY_STATE);
  session.remove(KEY_VERIFIER);
  removeLegacyTokens();
}

export type TokenResult =
  | { kind: "ok"; token: string }
  /** no login, or Spotify says the login was revoked: show the login screen */
  | { kind: "logged-out" }
  /** network trouble or Spotify busy: keep the login, try again soon */
  | { kind: "unavailable" };

let refreshing: Promise<TokenResult> | null = null;

/** A working access token, refreshed if it's about to expire. */
export async function getAccessToken(clientId: string): Promise<TokenResult> {
  if (memory && memory.expiresAt - Date.now() > 60_000) return { kind: "ok", token: memory.accessToken };
  const { s, key } = refreshStore();
  const refreshToken = s.get(key);
  if (!refreshToken) return { kind: "logged-out" };

  // Several callers may ask at once; only refresh once.
  refreshing ??= refresh(clientId, refreshToken).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Throw away the access token and get a new one (used after a 401). */
export async function forceRefresh(clientId: string): Promise<TokenResult> {
  memory = null;
  return getAccessToken(clientId);
}

async function refresh(clientId: string, refreshToken: string): Promise<TokenResult> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (!res.ok) {
    if (refreshFailureIsFinal(res.status)) {
      logout();
      return { kind: "logged-out" };
    }
    return { kind: "unavailable" };
  }
  try {
    const fresh = tokensFromResponse(await res.json(), refreshToken);
    saveTokens(fresh);
    return { kind: "ok", token: fresh.accessToken };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Test helper: reset in-memory state. */
export function _resetForTests(): void {
  memory = null;
  refreshing = null;
  remember = false;
}

async function describeTokenError(res: Response): Promise<string> {
  let code = "";
  let description = "";
  try {
    const j = (await res.json()) as { error?: unknown; error_description?: unknown };
    code = typeof j.error === "string" ? j.error : "";
    description = typeof j.error_description === "string" ? j.error_description : "";
  } catch {
    /* not JSON */
  }
  if (/redirect/i.test(description)) {
    return `Couldn't finish login. Check that ${redirectUri()} is listed as a Redirect URI in your Spotify app.`;
  }
  if (code === "invalid_grant") return "That login link expired. Please connect again.";
  if (code === "invalid_client") return loginErrorMessage("invalid_client");
  return `Couldn't finish login (Spotify error ${res.status}). Please try again.`;
}
