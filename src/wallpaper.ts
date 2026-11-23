// Wallpaper mode (`?wallpaper`): for running Lyric Lights as an animated desktop
// background, e.g. in Lively Wallpaper on Windows (see docs/WINDOWS_WALLPAPER.md).
//
// What changes in this mode:
// - No buttons, hints, toasts or cursor: it's a background, not an app window.
// - No screen wake lock, so the monitor can still go to sleep.
// - A frame-rate cap (30 fps by default, `&fps=` from 10 to 60) to go easy on the GPU.
// - `&style=glow|aurora|vinyl|tunnel` picks the style (Wallpaper Engine's Style setting).
// - The login can be remembered across restarts (see auth.ts `setRememberLogin`), because a
//   wallpaper that logs out on every reboot isn't much use.
//
// Spotify sends you back to the plain page address after login (the Redirect URI can't carry
// our query string), so the mode is also remembered in sessionStorage for the trip.

import { STYLES, type VisualStyle } from "./settings";
import { local, session } from "./storage";

const KEY_MODE = "sv.wallpaper";
export const DEFAULT_FPS = 30;
export const MIN_FPS = 10;
export const MAX_FPS = 60;

export interface WallpaperOptions {
  /** frames per second to draw at */
  fps: number;
  /** visual style picked in the wallpaper app (Wallpaper Engine can't type `V`), if any */
  style?: VisualStyle;
}

/** Read wallpaper mode from the address bar. Null when it's off. Pure; tested. */
export function parseWallpaper(search: string): WallpaperOptions | null {
  const params = new URLSearchParams(search);
  if (!params.has("wallpaper")) return null;
  const raw = params.get("fps");
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  const fps = Number.isFinite(n) ? Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(n))) : DEFAULT_FPS;
  const style = params.get("style");
  return (STYLES as readonly string[]).includes(style ?? "") ? { fps, style: style as VisualStyle } : { fps };
}

/**
 * Wallpaper mode for this page load: from the address bar, or carried over a login redirect.
 * Keeps the address bar showing `?wallpaper` so a reload stays in wallpaper mode.
 */
export function detectWallpaper(): WallpaperOptions | null {
  const fromUrl = parseWallpaper(location.search);
  if (fromUrl) {
    session.set(KEY_MODE, location.search);
    return fromUrl;
  }
  const carried = session.get(KEY_MODE);
  if (carried === null) return null;
  const opts = parseWallpaper(carried);
  if (!opts) return null;
  // Only restore after a Spotify redirect (or a reload of one); a plain visit in the same tab
  // without `?wallpaper` means the user wants the normal app.
  const url = new URL(location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
    session.remove(KEY_MODE);
    return null;
  }
  return opts;
}

/** After the login redirect is handled, put `?wallpaper` back in the address bar. */
export function restoreWallpaperUrl(): void {
  const carried = session.get(KEY_MODE);
  if (carried && !new URLSearchParams(location.search).has("wallpaper")) {
    window.history.replaceState(null, "", location.pathname + carried + location.hash);
  }
}

/** Frame limiter: true when enough time has passed to draw the next frame. */
export class FrameCap {
  private last = -Infinity;
  private readonly interval: number;
  constructor(fps: number) {
    // A little slack so 60 Hz screens hit 30 fps exactly instead of dropping to 20.
    this.interval = 1000 / fps - 2;
  }
  ready(now: number): boolean {
    if (now - this.last < this.interval) return false;
    this.last = now;
    return true;
  }
}

// ---------- pairing (Wallpaper Engine) ----------
//
// Wallpaper Engine passes mouse clicks to a web wallpaper but never the keyboard, so you can't
// type your Spotify password into it. Instead:
// 1. Open `?pair` in your normal browser and log in. That login's refresh token is shown once as
//    a "pairing code" and is NOT kept in that browser.
// 2. Paste it into the wallpaper's "Spotify pairing code" property in Wallpaper Engine.
// 3. The wallpaper package (wallpaper-engine/index.html) opens `?wallpaper#pair=<code>`. The code
//    rides in the #fragment, which browsers never send to any server, and is wiped from the
//    address bar straight away.
//
// Spotify rotates refresh tokens, so after the first use the wallpaper's own (newer) token is the
// one to keep. We remember a hash of the last code used and only take a code that's new.

const KEY_PAIRING = "sv.pairing";
const KEY_PAIRED_HASH = "sv.wallpaper.paired";

/** `?pair` page (making a pairing code), also carried over the login redirect. */
export function detectPairing(): boolean {
  const url = new URL(location.href);
  if (url.searchParams.has("pair")) {
    session.set(KEY_PAIRING, "1");
    return true;
  }
  if (session.get(KEY_PAIRING) === null) return false;
  if (url.searchParams.has("code") || url.searchParams.has("error")) return true;
  session.remove(KEY_PAIRING);
  return false;
}

/** Done pairing (or gave up): forget the pairing flag for this tab. */
export function endPairing(): void {
  session.remove(KEY_PAIRING);
}

/** Read `#pair=<code>` from a hash string. Pure; tested. */
export function parsePairHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("pair");
  return code && code.trim() ? code.trim() : null;
}

/** Take the pairing code out of the address bar (and wipe it from there). */
export function takePairCode(): string | null {
  const code = parsePairHash(location.hash);
  if (location.hash) window.history.replaceState(null, "", location.pathname + location.search);
  return code;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * True the first time a given code is seen. The wallpaper app hands the same code over on every
 * start; only a new one (you paired again) should replace the current login.
 */
export async function isNewPairCode(code: string, store = local): Promise<boolean> {
  const hash = await sha256Hex(code);
  if (store.get(KEY_PAIRED_HASH) === hash) return false;
  store.set(KEY_PAIRED_HASH, hash);
  return true;
}
