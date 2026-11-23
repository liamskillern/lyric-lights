// Demo mode (?demo): two made-up songs with original lyrics and generated cover art,
// so anyone can see the visualizer without a Spotify login.

import { parseLrc, type Lyrics } from "./lyrics";
import { NOTHING_PLAYING, type Playback, type Track } from "./spotify";

interface DemoSong {
  track: Track;
  lrc: string;
  art: [string, string, string]; // gradient colors for the fake cover
}

const SONGS: DemoSong[] = [
  {
    track: { id: "demo-1", name: "Neon Weather", artists: ["The Demo Tapes"], album: "Night Drive", artUrl: null, thumbUrl: null, durationMs: 56_000 },
    art: ["#ff2e88", "#3a0ca3", "#00d4ff"],
    lrc: `[00:03.50]Midnight on the highway, city lights in my eyes
[00:07.50]Rain on the windshield, counting every mile
[00:11.50]Neon in the puddles, painting all the streets
[00:15.50]Your heart is the radio, I'm singing every beat
[00:19.50]
[00:21.50]Stars above the skyline, shining through the dark
[00:25.50]Light a little fire, give the night a spark
[00:29.50]Gold in the morning, sunshine on the hill
[00:33.50]Snow on the mountain and the world is standing still
[00:37.50]We were never lonely, we were only cold
[00:41.50]Hold me in the summer, flowers on the road
[00:45.50]Diamonds in the river, everything we own
[00:49.50]Midnight on the highway, driving us home
[00:54.00]`,
  },
  {
    track: { id: "demo-2", name: "Paper Satellites", artists: ["Lo-Fi Orbit"], album: "Quiet Rooms", artUrl: null, thumbUrl: null, durationMs: 44_000 },
    art: ["#0b3d2e", "#f4a261", "#e9c46a"],
    lrc: `[00:03.00]Tears like rain on a paper satellite
[00:08.00]Falling through the winter, frozen in the light
[00:13.00]I lost you in the ocean, I lost you in the cold
[00:18.00]Every broken promise that the empty stars told
[00:23.00]But the sun comes up and the garden starts to bloom
[00:28.00]Love is a fire in a quiet little room
[00:33.00]Love is a fire, love is a fire
[00:38.00]Love is a fire, burning brighter
[00:42.00]`,
  },
];

function makeArt([a, b, c]: [string, string, string], seed: number): HTMLCanvasElement {
  const size = 300;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // A big sun/planet and some stripes so it looks like a record cover.
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(size * (0.35 + seed * 0.3), size * 0.42, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgb(0 0 0 / 0.35)";
  for (let i = 0; i < 6; i++) ctx.fillRect(0, size * 0.62 + i * 14, size, 6);
  return cv;
}

export interface DemoSource {
  /** what's "playing" at this moment */
  playback(now: number): Playback;
  lyricsFor(trackId: string): Lyrics;
  artFor(trackId: string): HTMLCanvasElement | null;
  thumbFor(trackId: string): string | null;
  /** the song after this one (demo songs loop) */
  nextAfter(trackId: string): Track | null;
}

export function createDemo(start = performance.now()): DemoSource {
  const arts = new Map(SONGS.map((s, i) => [s.track.id, makeArt(s.art, i)]));
  const thumbs = new Map<string, string>();
  const total = SONGS.reduce((n, s) => n + s.track.durationMs, 0);

  return {
    playback(now) {
      let t = (now - start) % total;
      for (const s of SONGS) {
        if (t < s.track.durationMs) return { track: s.track, isPlaying: true, progressMs: t, at: now };
        t -= s.track.durationMs;
      }
      return NOTHING_PLAYING;
    },
    lyricsFor(id) {
      const s = SONGS.find((x) => x.track.id === id);
      return s ? { kind: "synced", lines: parseLrc(s.lrc) } : { kind: "none" };
    },
    artFor(id) {
      return arts.get(id) ?? null;
    },
    nextAfter(id) {
      const i = SONGS.findIndex((s) => s.track.id === id);
      return i < 0 ? null : SONGS[(i + 1) % SONGS.length].track;
    },
    thumbFor(id) {
      if (!thumbs.has(id)) {
        const art = arts.get(id);
        if (art) thumbs.set(id, art.toDataURL("image/png"));
      }
      return thumbs.get(id) ?? null;
    },
  };
}
