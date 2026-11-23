// Android wallpaper mode (`?android-wallpaper`): the page runs inside the Android live wallpaper
// (android/app/src/main/java/…/wallpaper/). Not the same as `?wallpaper`, which is the Windows
// desktop wallpaper and logs in to Spotify itself.
//
// There is no Spotify login here. The Android side reads what's playing from the phone's media
// controls (the same feed the lock screen player uses) and posts it to the page with
// WebView.postWebMessage. Everything it sends is treated as untrusted and checked here, the same
// way Spotify and LRCLIB responses are.

import type { Settings } from "./settings";
import type { Playback, Track } from "./spotify";

export const ANDROID_WALLPAPER_PARAM = "android-wallpaper";

export function isAndroidWallpaper(search: string): boolean {
  return new URLSearchParams(search).has(ANDROID_WALLPAPER_PARAM);
}

/** How hard the wallpaper works. Lower = less battery. */
export const QUALITIES = {
  /** full sharpness, smooth motion */
  sharp: { fps: 60, maxDpr: 2 },
  /** the default: a bit softer, half the frames */
  balanced: { fps: 30, maxDpr: 1.5 },
  /** softer still, fewer frames */
  saver: { fps: 20, maxDpr: 1 },
} as const;
export type Quality = keyof typeof QUALITIES;

/** Frames per second on the clock screen (nothing playing). It barely moves. */
export const IDLE_FPS = 5;

export const LIMITS = {
  /** the whole message, as JSON text */
  messageChars: 600_000,
  /** album art as a data: URL (the app sends a ~300 px JPEG, usually 20–40 KB) */
  artChars: 500_000,
  text: 300,
  artists: 10,
} as const;

export type HostMessage =
  | { type: "playback"; playback: Omit<Playback, "at"> }
  | { type: "settings"; settings: Partial<Settings>; quality: Quality }
  | { type: "visible"; visible: boolean };

const ART_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const str = (v: unknown, max: number = LIMITS.text): string | null =>
  typeof v === "string" ? v.slice(0, max) : null;
const finite = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;

function parseTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  const id = str(r.id, 1000);
  if (!name || !id) return null;
  const artists = Array.isArray(r.artists)
    ? r.artists.slice(0, LIMITS.artists).map((a) => str(a)).filter((a): a is string => !!a)
    : [];
  return {
    id,
    name,
    artists,
    album: str(r.album) ?? "",
    artUrl: null,
    thumbUrl: null,
    durationMs: Math.round(finite(r.durationMs, 0, 24 * 3600_000) ?? 0),
  };
}

/**
 * Check one message from the Android side. Anything malformed returns null and is ignored.
 * Settings are only picked out here; parseSettings() validates their values. (Pure, tested.)
 */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data !== "string" || data.length > LIMITS.messageChars) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  switch (r.type) {
    case "playback": {
      const track = r.track == null ? null : parseTrack(r.track);
      if (r.track != null && !track) return null;
      const art = typeof r.art === "string" && r.art.length <= LIMITS.artChars && ART_RE.test(r.art) ? r.art : null;
      if (track && art) {
        track.artUrl = art;
        track.thumbUrl = art;
      }
      return {
        type: "playback",
        playback: {
          track,
          isPlaying: track !== null && r.isPlaying === true,
          progressMs: Math.round(finite(r.positionMs, 0, 24 * 3600_000) ?? 0),
        },
      };
    }
    case "settings": {
      const s = r.settings && typeof r.settings === "object" && !Array.isArray(r.settings) ? (r.settings as Record<string, unknown>) : {};
      // Only the settings the wallpaper screen offers. The rest keep the wallpaper defaults.
      const picked: Record<string, unknown> = {};
      for (const k of ["style", "showLyrics", "karaoke", "font", "lyricSize", "effectStrength", "reducedMotion", "beatPulse"]) {
        if (Object.hasOwn(s, k)) picked[k] = s[k];
      }
      const quality = typeof r.quality === "string" && Object.hasOwn(QUALITIES, r.quality) ? (r.quality as Quality) : "balanced";
      return { type: "settings", settings: picked as Partial<Settings>, quality };
    }
    case "visible":
      return typeof r.visible === "boolean" ? { type: "visible", visible: r.visible } : null;
    default:
      return null;
  }
}

/**
 * Lets frames through at a fixed rate on top of requestAnimationFrame. (Pure, tested.)
 * The wallpaper skips frames instead of drawing every display refresh.
 */
export class FrameGate {
  private last = -Infinity;
  constructor(public fps: number) {}

  /** true when this frame should be drawn */
  shouldDraw(now: number): boolean {
    const interval = 1000 / this.fps;
    // A few ms of slack so a 60 Hz display reliably gives 30 fps rather than 20.
    if (now - this.last < interval - 4) return false;
    // Keep a steady rhythm, but don't try to "catch up" after a pause.
    this.last = now - this.last > interval * 2 ? now : this.last + interval;
    return true;
  }

  reset(): void {
    this.last = -Infinity;
  }
}

/**
 * Only messages from the Android app are accepted. WebView.postWebMessage delivers them with no
 * source window; anything posted by a script on the page itself (or a frame) has one.
 */
export function isFromHost(e: Pick<MessageEvent, "source">): boolean {
  return e.source === null;
}
