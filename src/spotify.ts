import type { TokenResult } from "./auth";

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

/** Turn one Spotify track object into our Track. Null for podcasts, ads or junk. (Pure, tested.) */
export function trackFromItem(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as NonNullable<CurrentlyPlayingJson["item"]> & { type?: string };
  if (item.type && item.type !== "track") return null;
  if (typeof item.name !== "string") return null;
  const imgs = Array.isArray(item.album?.images) ? item.album!.images! : [];
  const images = imgs.filter((i) => i && typeof i.url === "string").sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const thumb = [...images].reverse().find((i) => (i.width ?? 0) >= 64) ?? images[images.length - 1];
  const artists = Array.isArray(item.artists) ? item.artists : [];
  return {
    // Local files have no id; fall back to the uri so track changes still register.
    id: item.id ?? item.uri ?? `${item.name}-${item.duration_ms}`,
    name: item.name,
    artists: artists.map((a) => a?.name).filter((n): n is string => typeof n === "string" && n.length > 0),
    album: typeof item.album?.name === "string" ? item.album.name : "",
    artUrl: images[0]?.url ?? null,
    thumbUrl: thumb?.url ?? null,
    durationMs: typeof item.duration_ms === "number" ? item.duration_ms : 0,
  };
}

/** Turn the API's JSON into our Playback shape (pure, tested). */
export function parseCurrentlyPlaying(json: CurrentlyPlayingJson | null, at: number): Playback {
  const track = json && json.currently_playing_type === "track" ? trackFromItem(json.item) : null;
  if (!json || !track) return { ...NOTHING_PLAYING, isPlaying: Boolean(json?.is_playing), at };
  return {
    track,
    isPlaying: Boolean(json.is_playing),
    progressMs: typeof json.progress_ms === "number" ? json.progress_ms : 0,
    at,
  };
}

/** The next song in the user's queue, from GET /me/player/queue. (Pure, tested.) */
export function parseQueue(json: unknown): Track | null {
  const queue = (json as { queue?: unknown } | null)?.queue;
  if (!Array.isArray(queue)) return null;
  for (const item of queue.slice(0, 5)) {
    const t = trackFromItem(item);
    if (t) return t;
  }
  return null;
}

/** Next song, or null. Never throws: "Up next" is a nice-to-have. */
export async function fetchQueue(token: string): Promise<Track | null> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player/queue", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return parseQueue(await res.json());
  } catch {
    return null;
  }
}

/** 83000 → "1:23" */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
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

export const RETRY_MESSAGE = "Can't reach Spotify. Retrying…";

export interface PollerOptions {
  getToken: () => Promise<TokenResult>;
  onRefreshNeeded: () => Promise<TokenResult>;
  onPlayback: (p: Playback) => void;
  onError: (message: string | null) => void;
  onLoggedOut: () => void;
  /** optional: the next song in the queue (asked once per song and once near its end) */
  onQueue?: (next: Track | null) => void;
}

const hasDocument = () => typeof document !== "undefined";

/**
 * Polls every 1.5 s while music plays, slower when paused or the tab is hidden,
 * and right before the current song should end so the next one shows up fast.
 * Nothing that goes wrong in one poll stops the next one, except being logged out.
 */
export class SpotifyPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private last: Playback = NOTHING_PLAYING;
  private queueAskedFor = "";
  private queueAskedNearEnd = "";

  constructor(private opts: PollerOptions) {}

  /** Ask for the queue when a song starts and again in its last 20 s (it may have changed). */
  private maybeFetchQueue(token: string, p: Playback): void {
    const onQueue = this.opts.onQueue;
    const t = p.track;
    if (!onQueue || !t) return;
    const left = t.durationMs - positionAt(p, performance.now());
    let ask = false;
    if (this.queueAskedFor !== t.id) {
      this.queueAskedFor = t.id;
      ask = true;
    } else if (left < 20_000 && this.queueAskedNearEnd !== t.id) {
      this.queueAskedNearEnd = t.id;
      ask = true;
    }
    if (ask) void fetchQueue(token).then((next) => !this.stopped && onQueue(next));
  }

  start(): void {
    this.stopped = false;
    void this.tick();
    if (hasDocument()) document.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (hasDocument()) document.removeEventListener("visibilitychange", this.onVisibility);
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
    if (hasDocument() && document.visibilityState === "hidden") return 10_000;
    if (!this.last.track || !this.last.isPlaying) return 4_000;
    const left = this.last.track.durationMs - positionAt(this.last, performance.now());
    if (left > 0 && left < 1_500) return Math.max(250, left + 150);
    return 1_500;
  }

  private async tick(): Promise<void> {
    try {
      await this.poll();
    } catch {
      // A bad response or a bug in one poll must not stop the app: report it and keep going.
      if (this.stopped) return;
      this.opts.onError(RETRY_MESSAGE);
      this.pollSoon(5_000);
    }
  }

  /** Returns the token, or null after handling "logged out" / "try later". */
  private handleAuth(auth: TokenResult): string | null {
    if (auth.kind === "ok") return auth.token;
    if (auth.kind === "logged-out") {
      this.opts.onLoggedOut();
    } else {
      this.opts.onError(RETRY_MESSAGE);
      this.pollSoon(5_000);
    }
    return null;
  }

  private async poll(): Promise<void> {
    let token = this.handleAuth(await this.opts.getToken());
    if (!token) return;

    let result = await fetchCurrentlyPlaying(token);
    if (result.kind === "unauthorized") {
      token = this.handleAuth(await this.opts.onRefreshNeeded());
      if (!token) return;
      result = await fetchCurrentlyPlaying(token);
      if (result.kind === "unauthorized") return this.opts.onLoggedOut();
    }

    if (this.stopped) return;
    switch (result.kind) {
      case "ok":
        this.last = result.playback;
        this.opts.onError(null);
        this.opts.onPlayback(result.playback);
        this.maybeFetchQueue(token, result.playback);
        return this.pollSoon(this.nextDelay());
      case "rate-limited":
        return this.pollSoon(result.retryAfterMs);
      case "error":
        this.opts.onError(result.message);
        return this.pollSoon(5_000);
    }
  }
}
