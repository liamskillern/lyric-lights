// Reads what's playing from the Spotify Web API and keeps a smooth playback clock.
// Spotify has no push events for the Web API, so we poll and fill the gaps locally.

export interface Track {
  id: string;
  name: string;
  artists: string[];
  album: string;
  /** largest album image, or null */
  artUrl: string | null;
  /** small album image for the corner overlay */
  thumbUrl: string | null;
  durationMs: number;
}

export interface Playback {
  track: Track | null;
  isPlaying: boolean;
  progressMs: number;
  /** performance.now() at which progressMs was true */
  at: number;
}

export const NOTHING_PLAYING: Playback = { track: null, isPlaying: false, progressMs: 0, at: 0 };

interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

interface CurrentlyPlayingJson {
  is_playing?: boolean;
  progress_ms?: number | null;
  currently_playing_type?: string;
  item?: {
    id?: string | null;
    uri?: string;
    name?: string;
    duration_ms?: number;
    artists?: { name: string }[];
    album?: { name?: string; images?: SpotifyImage[] };
  } | null;
}

/** Turn the API's JSON into our Playback shape (pure, tested). */
export function parseCurrentlyPlaying(json: CurrentlyPlayingJson | null, at: number): Playback {
  const item = json?.item;
  if (!json || !item || json.currently_playing_type !== "track") {
    return { ...NOTHING_PLAYING, isPlaying: Boolean(json?.is_playing), at };
  }
  const images = [...(item.album?.images ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const thumb = [...images].reverse().find((i) => (i.width ?? 0) >= 64) ?? images[images.length - 1];
  return {
    track: {
      // Local files have no id; fall back to the uri so track changes still register.
      id: item.id ?? item.uri ?? `${item.name}-${item.duration_ms}`,
      name: item.name ?? "Unknown track",
      artists: (item.artists ?? []).map((a) => a.name).filter(Boolean),
      album: item.album?.name ?? "",
      artUrl: images[0]?.url ?? null,
      thumbUrl: thumb?.url ?? null,
      durationMs: item.duration_ms ?? 0,
    },
    isPlaying: Boolean(json.is_playing),
    progressMs: json.progress_ms ?? 0,
    at,
  };
}

/** Where the song is right now, estimated between polls. */
export function positionAt(p: Playback, now: number): number {
  if (!p.track) return 0;
  const pos = p.isPlaying ? p.progressMs + (now - p.at) : p.progressMs;
  return Math.max(0, Math.min(pos, p.track.durationMs || pos));
}

export type FetchResult =
  | { kind: "ok"; playback: Playback }
  | { kind: "unauthorized" }
  | { kind: "rate-limited"; retryAfterMs: number }
  | { kind: "error"; message: string };

export async function fetchCurrentlyPlaying(token: string): Promise<FetchResult> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: "error", message: "Can't reach Spotify. Check your connection." };
  }
  // The position was measured somewhere during the round trip; the midpoint is the best guess.
  const at = (started + performance.now()) / 2;

  if (res.status === 204) return { kind: "ok", playback: { ...NOTHING_PLAYING, at } };
  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 429) {
    const secs = Number(res.headers.get("Retry-After") ?? "5");
    return { kind: "rate-limited", retryAfterMs: (Number.isFinite(secs) ? secs : 5) * 1000 };
  }
  if (res.status === 403) {
    return {
      kind: "error",
      message: "Spotify refused access (403). Make sure your account is added under User Management in your Spotify app.",
    };
  }
  if (!res.ok) return { kind: "error", message: `Spotify error ${res.status}.` };
  return { kind: "ok", playback: parseCurrentlyPlaying(await res.json(), at) };
}

export interface PollerOptions {
  getToken: () => Promise<string | null>;
  onRefreshNeeded: () => Promise<string | null>;
  onPlayback: (p: Playback) => void;
  onError: (message: string | null) => void;
  onLoggedOut: () => void;
}

/**
 * Polls every 1.5 s while music plays, slower when paused or the tab is hidden,
 * and right before the current song should end so the next one shows up fast.
 */
export class SpotifyPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private last: Playback = NOTHING_PLAYING;

  constructor(private opts: PollerOptions) {}

  start(): void {
    this.stopped = false;
    void this.tick();
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = () => {
    if (document.visibilityState === "visible") this.pollSoon(0);
  };

  private pollSoon(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private nextDelay(): number {
    if (document.visibilityState === "hidden") return 10_000;
    if (!this.last.track || !this.last.isPlaying) return 4_000;
    const left = this.last.track.durationMs - positionAt(this.last, performance.now());
    if (left > 0 && left < 1_500) return Math.max(250, left + 150);
    return 1_500;
  }

  private async tick(): Promise<void> {
    let token = await this.opts.getToken();
    if (!token) return this.opts.onLoggedOut();

    let result = await fetchCurrentlyPlaying(token);
    if (result.kind === "unauthorized") {
      token = await this.opts.onRefreshNeeded();
      if (!token) return this.opts.onLoggedOut();
      result = await fetchCurrentlyPlaying(token);
      if (result.kind === "unauthorized") return this.opts.onLoggedOut();
    }

    if (this.stopped) return;
    switch (result.kind) {
      case "ok":
        this.last = result.playback;
        this.opts.onError(null);
        this.opts.onPlayback(result.playback);
        return this.pollSoon(this.nextDelay());
      case "rate-limited":
        return this.pollSoon(result.retryAfterMs);
      case "error":
        this.opts.onError(result.message);
        return this.pollSoon(5_000);
    }
  }
}
