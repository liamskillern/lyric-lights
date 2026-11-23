// Wallpaper mode (`?wallpaper`): for running Lyric Lights as an animated desktop
// background, e.g. in Lively Wallpaper on Windows (see docs/WINDOWS_WALLPAPER.md).
//
// What changes in this mode:
// - No buttons, hints, toasts or cursor: it's a background, not an app window.
// - No screen wake lock, so the monitor can still go to sleep.
// - A frame-rate cap (30 fps by default, `&fps=` from 10 to 60) to go easy on the GPU.
// - The login can be remembered across restarts (see auth.ts `setRememberLogin`), because a
//   wallpaper that logs out on every reboot isn't much use.
//
// Spotify sends you back to the plain page address after login (the Redirect URI can't carry
// our query string), so the mode is also remembered in sessionStorage for the trip.

import { session } from "./storage";

const KEY_MODE = "sv.wallpaper";
export const DEFAULT_FPS = 30;
export const MIN_FPS = 10;
export const MAX_FPS = 60;

export interface WallpaperOptions {
  /** frames per second to draw at */
  fps: number;
}

/** Read wallpaper mode from the address bar. Null when it's off. Pure; tested. */
export function parseWallpaper(search: string): WallpaperOptions | null {
  const params = new URLSearchParams(search);
  if (!params.has("wallpaper")) return null;
  const raw = params.get("fps");
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  const fps = Number.isFinite(n) ? Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(n))) : DEFAULT_FPS;
  return { fps };
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
