import "./style.css";
import { AudioInput, canCaptureSystemAudio, NoAudioSharedError, SupersededError, type AudioSource } from "./audio";
import * as auth from "./auth";
import { createDemo, type DemoSource } from "./demo";
import { isFramed } from "./frame";
import { fetchLyrics, lineIndexAt, type LyricLine, type Lyrics } from "./lyrics";
import { analyzeSong, analyzeText, type SongMood } from "./mood";
import { DEFAULT_PALETTE, paletteFromImage, paletteFromUrl, type Palette } from "./palette";
import { computeScene, type SceneTarget } from "./scene";
import { formatTime, NOTHING_PLAYING, positionAt, SpotifyPoller, type Playback, type Track } from "./spotify";
import { LYRIC_SIZES, STYLE_NAMES, STYLES, defaultSettings, loadSettings, parseSettings, saveSettings, type Settings } from "./settings";
import { shouldIdle } from "./render/idle";
import { LYRIC_ANIM_NAMES, LYRIC_ANIMS, type LyricAnim } from "./render/lyricAnim";
import { FONT_CHOICES, FONTS, loadFont, resolveFont, type FontChoice } from "./fonts";
import { estimateTempoFromLyrics, GUESS_CONFIDENCE, type TempoGuess } from "./tempo";
import { BeatClock, breathFor, pulseEnvelope, pumpFor, TapTempo, type ClockSource } from "./beatClock";
import { Visualizer } from "./render/visualizer";
import { FrameGate, IDLE_FPS, isFromHost, isAndroidWallpaper, parseHostMessage, QUALITIES, type Quality } from "./androidWallpaper";

// ---------- DOM ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const panel = $("panel");
const hud = $("hud");
const hint = $("hint");
const toastEl = $("toast");
const thumb = $<HTMLImageElement>("thumb");
const npTitle = $("np-title");
const npArtist = $("np-artist");
const npStatus = $("np-status");
const btnSettings = $<HTMLButtonElement>("btn-settings");
const settingsDialog = $<HTMLDialogElement>("settings");
const setStyle = $<HTMLSelectElement>("set-style");
const setStrength = $<HTMLInputElement>("set-strength");
const outStrength = $<HTMLOutputElement>("out-strength");
const setReduced = $<HTMLInputElement>("set-reduced");
const setLyrics = $<HTMLInputElement>("set-lyrics");
const setLyricSize = $<HTMLSelectElement>("set-lyric-size");
const setOffset = $<HTMLInputElement>("set-offset");
const outOffset = $<HTMLOutputElement>("out-offset");
const setOffsetReset = $<HTMLButtonElement>("set-offset-reset");
const beatOff = $<HTMLButtonElement>("beat-off");
const beatSystem = $<HTMLButtonElement>("beat-system");
const beatMic = $<HTMLButtonElement>("beat-mic");
const setSensitivity = $<HTMLInputElement>("set-sensitivity");
const outSensitivity = $<HTMLOutputElement>("out-sensitivity");
const setUpNext = $<HTMLInputElement>("set-upnext");
const setPulse = $<HTMLSelectElement>("set-pulse");
const btnTap = $<HTMLButtonElement>("btn-tap");
const setFont = $<HTMLSelectElement>("set-font");
const setAnim = $<HTMLSelectElement>("set-anim");
const setKick = $<HTMLSelectElement>("set-kick");
const setKaraoke = $<HTMLInputElement>("set-karaoke");
const btnMic = $<HTMLButtonElement>("btn-mic");
const btnFull = $<HTMLButtonElement>("btn-full");
const btnLogout = $<HTMLButtonElement>("btn-logout");
const npTime = $("np-time");
const beatDot = $("beat-dot");
let beatDotTimer = 0;
function flashBeatDot(): void {
  beatDot.classList.add("on");
  clearTimeout(beatDotTimer);
  beatDotTimer = window.setTimeout(() => beatDot.classList.remove("on"), 110);
}
const progressEl = $("progress");
const progressFill = $("progress-fill");
const upnext = $("upnext");
const upnextArt = $<HTMLImageElement>("upnext-art");
const upnextTitle = $("upnext-title");
const upnextArtist = $("upnext-artist");

/** Tiny element builder. Text always goes in as textContent, never as HTML. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

let toastTimer = 0;
function toast(msg: string, ms = 2600): void {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), ms);
}

// ---------- state ----------

const isDemo = new URLSearchParams(location.search).has("demo");
/** running inside the Android live wallpaper (see androidWallpaper.ts) */
const isAndroidWp = isAndroidWallpaper(location.search);
const viz = new Visualizer(canvas);
const audio = new AudioInput();
audio.onEnded = () => {
  refreshBeatUi();
  toast("Beat sync off (sharing stopped)");
};

const prefersReducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
let settings: Settings = loadSettings(defaultSettings(prefersReducedMotion, canCaptureSystemAudio()));

const state = {
  playback: NOTHING_PLAYING as Playback,
  /** undefined until the first answer, so "nothing playing" at startup still updates the card */
  trackId: undefined as string | null | undefined,
  lyrics: { kind: "none" } as Lyrics,
  syncedLines: null as LyricLine[] | null,
  song: null as SongMood | null,
  palette: DEFAULT_PALETTE as Palette,
  loadToken: 0,
  /** performance.now() when music was last playing */
  lastPlayingAt: 0,
  /** at least one answer from Spotify so far */
  gotPlayback: false,
  /** tempo guessed from this song's lyric timing */
  lyricTempo: null as TempoGuess | null,
  /** tempo the user tapped for this song */
  tapped: null as { bpm: number; anchor: number } | null,
  /** beat number on the previous frame (to spot each new beat) */
  lastBeatIdx: -1,
  /** next song in the queue, if known */
  next: null as Track | null,
};

let demo: DemoSource | null = null;
let poller: SpotifyPoller | null = null;
let lyricAbort: AbortController | null = null;

// ---------- screens ----------

function showPanel(...content: Node[]): void {
  panel.replaceChildren(h("div", { className: "card" }, ...content));
  panel.hidden = false;
  hud.hidden = true;
  hint.hidden = true;
}

function showSetup(error?: string): void {
  const uri = auth.redirectUri();
  const input = h("input", { type: "text", placeholder: "Paste your Client ID", autocomplete: "off", spellcheck: false });
  input.setAttribute("aria-label", "Spotify Client ID");
  const err = h("p", { className: "error" }, error ?? "");
  err.hidden = !error;
  const save = h("button", { className: "primary", type: "button" }, "Save and connect");
  save.addEventListener("click", () => {
    if (!auth.isValidClientId(input.value)) {
      err.textContent = "That doesn't look like a Client ID (32 letters and numbers).";
      err.hidden = false;
      return;
    }
    auth.setClientId(input.value);
    void auth.beginLogin(input.value.trim());
  });
  const copy = h("button", { className: "small", type: "button" }, "Copy");
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(uri).then(() => toast("Redirect URI copied"));
  });

  showPanel(
    h("h1", {}, "Lyric Lights"),
    h("p", {}, "One-time setup: this app talks to Spotify through your own free Spotify developer app."),
    h(
      "ol",
      {},
      h("li", {}, "Open ", link("https://developer.spotify.com/dashboard", "developer.spotify.com/dashboard"), " and click Create app."),
      h("li", {}, "Add this Redirect URI exactly:", h("div", { className: "copy-row" }, h("code", {}, uri), copy)),
      h("li", {}, "Tick Web API, save, and copy the Client ID from the app's settings."),
    ),
    h("div", { className: "row" }, input, save),
    err,
    h("p", { className: "fine-print" }, "No Spotify account handy? ", link("?demo", "Watch the demo"), ". ", link("privacy.html", "Privacy policy"), "."),
  );
  input.focus();
}

function showLogin(error?: string, justLoggedOut = false): void {
  const btn = h("button", { className: "primary", type: "button" }, "Connect Spotify");
  btn.addEventListener("click", () => {
    const id = auth.getClientId();
    if (id) void auth.beginLogin(id);
    else showSetup();
  });
  const change = h("button", { className: "small", type: "button" }, "Use a different Client ID");
  change.addEventListener("click", () => showSetup());

  const content: Node[] = [
    h("h1", {}, "Lyric Lights"),
    h("p", {}, "Play a song on Spotify anywhere (phone, computer, speaker) and this screen turns it into light: colors from the album art, effects from the lyrics."),
  ];
  if (error) content.push(h("p", { className: "error" }, error));
  if (justLoggedOut) {
    content.push(
      h("p", {}, "You're logged out on this device. To cut this app off from your Spotify account completely, remove it at ", link(auth.REVOKE_URL, "spotify.com/account/apps"), "."),
    );
  }
  content.push(
    h("div", { className: "row" }, btn, h("a", { className: "button", href: "?demo" }, "Watch the demo")),
    h("div", { className: "row" }, change),
    h(
      "p",
      { className: "fine-print" },
      "Your login is kept only in this tab and forgotten when you close it. There's no server: the page talks straight to Spotify and LRCLIB (for lyrics). ",
      link("privacy.html", "Privacy policy"),
      ".",
    ),
  );
  showPanel(...content);
}

function link(href: string, text: string): HTMLAnchorElement {
  const external = href.startsWith("http");
  return h("a", { href, target: external ? "_blank" : "", rel: external ? "noopener noreferrer" : "" }, text);
}

function showVisualizer(): void {
  panel.hidden = true;
  hud.hidden = false;
  btnLogout.hidden = isDemo;
}

// ---------- track changes ----------

function onPlayback(p: Playback): void {
  state.playback = p;
  const id = p.track?.id ?? null;
  if (id !== state.trackId) void onTrackChange(p.track);
  if (p.isPlaying) state.lastPlayingAt = performance.now();
  state.gotPlayback = true;
  // From here on, the idle screen (clock) says when nothing is playing.
  hint.hidden = true;
}

function setNext(next: Track | null): void {
  state.next = next;
  if (!next) return;
  upnextTitle.textContent = next.name;
  upnextArtist.textContent = next.artists.join(", ");
  const thumb = demo ? demo.thumbFor(next.id) : next.thumbUrl;
  if (thumb) upnextArt.src = thumb;
  else upnextArt.removeAttribute("src");
}

let lastHudUpdate = 0;
/** Progress line, time and the Up next card. A few times a second is plenty. */
function updateProgress(now: number, pos: number): void {
  if (now - lastHudUpdate < 250) return;
  lastHudUpdate = now;
  const t = state.playback.track;
  progressEl.hidden = !t || !t.durationMs;
  if (!t || !t.durationMs) {
    npTime.textContent = "";
    upnext.classList.remove("show");
    return;
  }
  // Set via the style object (CSSOM), which the Content-Security-Policy allows.
  progressFill.style.transform = `scaleX(${Math.min(1, pos / t.durationMs).toFixed(4)})`;
  const tempo = currentTempo();
  const bpmText = tempo
    ? ` · ${tempo.source === "guessed" ? "~" : ""}${Math.round(tempo.bpm)} BPM${tempo.source === "tapped" ? " · tapped" : ""}`
    : "";
  beatDot.hidden = !tempo || settings.beatPulse === "off";
  npTime.textContent = `${formatTime(pos)} / ${formatTime(t.durationMs)}${bpmText}`;
  const left = t.durationMs - pos;
  const show = settings.showUpNext && state.playback.isPlaying && left < 15_000 && !!state.next && state.next.id !== t.id;
  upnext.hidden = false;
  upnext.classList.toggle("show", show);
}

/** The tempo to use right now: heard from the audio if beat sync is on, else guessed from lyrics. */
function currentTempo(): { bpm: number; source: ClockSource } | null {
  const heard = audio.bpm;
  if (heard) return { bpm: heard, source: "heard" };
  if (state.tapped) return { bpm: state.tapped.bpm, source: "tapped" };
  const exact = demo && state.trackId ? demo.bpmFor(state.trackId) : null;
  if (exact) return { bpm: exact.bpm, source: "exact" };
  const g = state.lyricTempo;
  if (g && g.confidence >= GUESS_CONFIDENCE) return { bpm: g.bpm, source: "guessed" };
  return null;
}

// ---------- beat clock ----------

const clock = new BeatClock();
const taps = new TapTempo();

/**
 * Keep the beat clock on the best tempo source (heard > tapped > exact > guessed) and in
 * phase with the music. Runs every frame, in song time.
 */
function syncClock(pos: number, lines: LyricLine[] | null, idx: number): void {
  const tempo = currentTempo();
  if (!tempo) return clock.clear();

  switch (tempo.source) {
    case "heard":
      if (!audio.beat) {
        if (clock.source === "heard") clock.setTempo(tempo.bpm, pos);
        return;
      }
      // A detected beat: start the clock on it, or nudge the clock toward it.
      if (clock.source !== "heard" || !clock.lockTo(pos)) {
        if (clock.source !== "heard" || Math.abs(clock.errorAt(pos)) > clock.beatMs * 0.3) clock.set(tempo.bpm, pos, "heard");
      }
      clock.setTempo(tempo.bpm, pos);
      return;
    case "tapped":
      if (clock.source !== "tapped" || clock.anchor !== state.tapped!.anchor) clock.set(tempo.bpm, state.tapped!.anchor, "tapped");
      return;
    case "exact": {
      const e = demo!.bpmFor(state.trackId!)!;
      if (clock.source !== "exact" || clock.bpm !== e.bpm || clock.anchor !== e.anchor) clock.set(e.bpm, e.anchor, "exact");
      return;
    }
    case "guessed": {
      // Line up with the current line's start (lines tend to start on the bar).
      const anchor = lines?.[Math.max(0, idx)]?.timeMs ?? 0;
      if (clock.source !== "guessed" || Math.abs(clock.bpm - tempo.bpm) > 0.5) clock.set(tempo.bpm, anchor, "guessed");
      else if (idx >= 0 && lines?.[idx]?.text.trim()) clock.lockTo(anchor);
      return;
    }
  }
}

/** Space / the Tap button: tap along with the song to set the beat. */
function tapBeat(): void {
  if (!state.playback.track) return toast("Play a song first, then tap along.");
  const pos = positionAt(state.playback, performance.now());
  const r = taps.tap(pos);
  if (r) {
    state.tapped = r;
    toast(`Beat set: ${Math.round(r.bpm)} BPM (tapped). Keep tapping to fine-tune.`, 2500);
  } else {
    toast(`Tap along with the beat… ${Math.max(0, 4 - taps.count)} more`, 1200);
  }
}

async function onTrackChange(track: Track | null): Promise<void> {
  state.trackId = track?.id ?? null;
  upnext.classList.remove("show");
  setNext(demo && track ? demo.nextAfter(track.id) : null);
  const token = ++state.loadToken;
  lyricAbort?.abort();
  lyricAbort = new AbortController();

  state.lyrics = { kind: "none" };
  state.syncedLines = null;
  state.song = null;
  state.lyricTempo = null;
  state.tapped = null;
  taps.reset();
  clock.clear();
  npStatus.textContent = "";

  if (!track) {
    npTitle.textContent = "Nothing playing";
    npArtist.textContent = "";
    thumb.removeAttribute("src");
    return;
  }

  npTitle.textContent = track.name;
  npArtist.textContent = track.artists.join(", ");
  document.title = `${track.name} · Lyric Lights`;
  viz.showTitle(track.name, track.artists.join(", "));
  npStatus.textContent = "Finding lyrics…";

  const titleText = `${track.name} ${track.album}`;

  // Colors and lyrics load in parallel.
  const colorJob = (async () => {
    if (demo) {
      const art = demo.artFor(track.id);
      thumb.src = demo.thumbFor(track.id) ?? "";
      return { palette: art ? paletteFromImage(art) : DEFAULT_PALETTE, image: art as CanvasImageSource | null };
    }
    if (track.thumbUrl) thumb.src = track.thumbUrl;
    if (!track.artUrl) return { palette: DEFAULT_PALETTE, image: null };
    return paletteFromUrl(track.artUrl);
  })();

  const lyricJob = demo
    ? Promise.resolve(demo.lyricsFor(track.id))
    : fetchLyrics(track, lyricAbort.signal).catch((): Lyrics => ({ kind: "none" }));

  const { palette, image } = await colorJob;
  if (token !== state.loadToken) return;
  state.palette = palette;
  viz.setArt(image);

  const lyrics = await lyricJob;
  if (token !== state.loadToken) return;
  state.lyrics = lyrics;
  switch (lyrics.kind) {
    case "synced":
      state.syncedLines = lyrics.lines;
      state.song = analyzeSong(lyrics.lines, titleText);
      state.lyricTempo = estimateTempoFromLyrics(lyrics.lines);
      npStatus.textContent = "";
      break;
    case "plain":
      state.song = analyzeText(lyrics.text, titleText);
      npStatus.textContent = "Lyrics found but not time-synced: mood only";
      break;
    case "instrumental":
      state.song = analyzeText("", titleText);
      npStatus.textContent = "Instrumental";
      break;
    case "none":
      state.song = analyzeText("", titleText);
      npStatus.textContent = "No lyrics found: colors only";
      break;
  }
  refreshFont();
}

// ---------- frame loop ----------

let lastSceneKey = "";
let lastScene: SceneTarget | null = null;
const LEAD_MS = 150; // show a line just before it's sung

function loop(now: number): void {
  if (isAndroidWp && !wallpaperFrame(now)) {
    requestAnimationFrame(loop);
    return;
  }
  if (demo) {
    const p = demo.playback(now);
    if (p.track?.id !== state.trackId || !state.playback.track) onPlayback(p);
    else state.playback = p;
  }

  const pos = positionAt(state.playback, now);
  const lines = state.syncedLines;
  const idx = lines ? lineIndexAt(lines, pos + LEAD_MS + settings.lyricOffsetMs) : -1;

  const idle = !demo && state.gotPlayback && shouldIdle(!!state.playback.track, state.playback.isPlaying, state.lastPlayingAt, now);
  viz.idle = idle;

  // Only recompute the scene when its inputs change.
  const tempo = currentTempo();
  const bpmKey = tempo ? Math.round(tempo.bpm / 4) : 0; // re-plan when tempo moves ~4 BPM
  const key = `${state.loadToken}|${idx}|${state.playback.isPlaying}|${state.song ? 1 : 0}|${state.palette === DEFAULT_PALETTE}|${idle}|${bpmKey}`;
  if (key !== lastSceneKey || !lastScene) {
    lastSceneKey = key;
    lastScene = computeScene({
      palette: state.palette,
      song: idle ? null : state.song,
      lineIndex: idle ? -1 : idx,
      isPlaying: idle ? false : state.playback.isPlaying,
      // Karaoke mode turns effects down so the words stay easy to read.
      effectStrength: settings.effectStrength * (settings.karaoke ? 0.5 : 1),
      bpm: idle ? null : (tempo?.bpm ?? null),
      reducedMotion: settings.reducedMotion,
    });
  }

  updateProgress(now, pos);
  audio.update(now);

  // The beat clock: a pulse on every beat, stronger on bar starts.
  syncClock(pos, lines, idx);
  let beatEnv = 0;
  let downbeat = false;
  if (clock.running && state.playback.isPlaying && !idle && settings.beatPulse !== "off") {
    const bi = clock.beatIndexAt(pos);
    const isBar = ((bi % 4) + 4) % 4 === 0;
    beatEnv = pulseEnvelope(clock.phaseAt(pos), isBar, settings.beatPulse);
    if (bi !== state.lastBeatIdx) {
      state.lastBeatIdx = bi;
      downbeat = isBar;
      flashBeatDot();
    }
  }

  viz.frame({
    now,
    target: lastScene,
    lyrics: lines,
    lineIndex: idx,
    songMs: pos + LEAD_MS + settings.lyricOffsetMs,
    beat: audio.beat,
    snare: audio.snare,
    level: audio.level,
    beatEnv: clock.running && settings.beatPulse !== "off" ? beatEnv : undefined,
    downbeat,
    breath: breathFor(settings.beatPulse, settings.reducedMotion),
    pump: pumpFor(settings.beatPulse, settings.reducedMotion),
    bands: audio.bands,
  });
  requestAnimationFrame(loop);
}

// ---------- settings ----------

/** Push settings into the app (and the form), then save them. */
function applySettings(save = true): void {
  viz.showLyrics = settings.showLyrics;
  viz.style = settings.style;
  viz.lyricAnim = settings.lyricAnim;
  viz.karaoke = settings.karaoke;
  viz.kickMotion = { off: 0, subtle: 1, strong: 1.8 }[settings.kickMotion];
  refreshFont();
  viz.lyricScale = LYRIC_SIZES[settings.lyricSize];
  viz.allowFlashes = !settings.reducedMotion;
  audio.setSensitivity(settings.beatSensitivity);
  lastSceneKey = ""; // recompute the scene with the new strength / motion
  syncSettingsForm();
  if (save) saveSettings(settings);
}

function syncSettingsForm(): void {
  setStyle.value = settings.style;
  setStrength.value = String(Math.round(settings.effectStrength * 100));
  outStrength.textContent = `${Math.round(settings.effectStrength * 100)}%`;
  setReduced.checked = settings.reducedMotion;
  setLyrics.checked = settings.showLyrics;
  setLyricSize.value = settings.lyricSize;
  setOffset.value = String(settings.lyricOffsetMs);
  const sec = settings.lyricOffsetMs / 1000;
  outOffset.textContent = sec === 0 ? "0 s" : `${sec > 0 ? "+" : ""}${sec.toFixed(1)} s`;
  setSensitivity.value = String(Math.round(settings.beatSensitivity * 100));
  outSensitivity.textContent = `${Math.round(settings.beatSensitivity * 100)}%`;
  setUpNext.checked = settings.showUpNext;
  setPulse.value = settings.beatPulse;
  setFont.value = settings.font;
  setAnim.value = settings.lyricAnim;
  setKick.value = settings.kickMotion;
  setKaraoke.checked = settings.karaoke;
  refreshBeatUi();
}

function update(change: Partial<Settings>): void {
  settings = parseSettings({ ...settings, ...change }, settings);
  applySettings();
}

setStrength.addEventListener("input", () => update({ effectStrength: Number(setStrength.value) / 100 }));
setReduced.addEventListener("change", () => update({ reducedMotion: setReduced.checked }));
setLyrics.addEventListener("change", () => update({ showLyrics: setLyrics.checked }));
setLyricSize.addEventListener("change", () => update({ lyricSize: setLyricSize.value as Settings["lyricSize"] }));
setOffset.addEventListener("input", () => update({ lyricOffsetMs: Number(setOffset.value) }));
setOffsetReset.addEventListener("click", () => update({ lyricOffsetMs: 0 }));
setSensitivity.addEventListener("input", () => update({ beatSensitivity: Number(setSensitivity.value) / 100 }));
setUpNext.addEventListener("change", () => update({ showUpNext: setUpNext.checked }));
setKick.addEventListener("change", () => update({ kickMotion: setKick.value as Settings["kickMotion"] }));
setAnim.addEventListener("change", () => update({ lyricAnim: setAnim.value as LyricAnim }));
setKaraoke.addEventListener("change", () => update({ karaoke: setKaraoke.checked }));
setFont.addEventListener("change", () => update({ font: setFont.value as FontChoice }));
setPulse.addEventListener("change", () => update({ beatPulse: setPulse.value as Settings["beatPulse"] }));
btnTap.addEventListener("click", tapBeat);
setStyle.addEventListener("change", () => update({ style: setStyle.value as Settings["style"] }));

// Fill the style picker and show it.
for (const style of STYLES) setStyle.append(h("option", { value: style }, STYLE_NAMES[style]));
$("style-field").hidden = false;

for (const f of FONT_CHOICES) setFont.append(h("option", { value: f }, f === "auto" ? "Auto (fits each song)" : FONTS[f].label));

/** Use the chosen font, or for Auto the one that fits this song. */
function refreshFont(): void {
  const key = resolveFont(settings.font, state.song, currentTempo()?.bpm ?? null);
  loadFont(key);
  viz.font = FONTS[key];
}

for (const a of LYRIC_ANIMS) setAnim.append(h("option", { value: a }, LYRIC_ANIM_NAMES[a]));

function cycleAnim(): void {
  const next = LYRIC_ANIMS[(LYRIC_ANIMS.indexOf(settings.lyricAnim) + 1) % LYRIC_ANIMS.length];
  update({ lyricAnim: next });
  toast(`Lyric animation: ${LYRIC_ANIM_NAMES[next]}${settings.reducedMotion && ["rise", "pop", "slide"].includes(next) ? " (fades while reduced motion is on)" : ""}`, 1800);
}

function toggleKaraoke(): void {
  update({ karaoke: !settings.karaoke });
  toast(settings.karaoke ? "Karaoke mode on" : "Karaoke mode off", 1500);
}

function cycleFont(): void {
  const next = FONT_CHOICES[(FONT_CHOICES.indexOf(settings.font) + 1) % FONT_CHOICES.length];
  update({ font: next });
  const key = resolveFont(next, state.song, currentTempo()?.bpm ?? null);
  toast(next === "auto" ? `Font: Auto (${FONTS[key].label} for this song)` : `Font: ${FONTS[next].label}`, 1800);
}

function cycleStyle(): void {
  const next = STYLES[(STYLES.indexOf(settings.style) + 1) % STYLES.length];
  update({ style: next });
  toast(`Style: ${STYLE_NAMES[next]}`, 1500);
}

function openSettings(): void {
  if (settingsDialog.open) return settingsDialog.close();
  syncSettingsForm();
  settingsDialog.showModal();
}
btnSettings.addEventListener("click", openSettings);

// ---------- controls ----------

function toggleLyrics(): void {
  update({ showLyrics: !settings.showLyrics });
  toast(settings.showLyrics ? "Lyrics on" : "Lyrics off");
}

function refreshBeatUi(): void {
  const src = audio.active ? audio.source : null;
  btnMic.setAttribute("aria-pressed", String(src !== null));
  beatOff.setAttribute("aria-pressed", String(src === null));
  beatSystem.setAttribute("aria-pressed", String(src === "system"));
  beatMic.setAttribute("aria-pressed", String(src === "mic"));
  beatSystem.hidden = !canCaptureSystemAudio();
}

function stopBeat(quiet = false): void {
  audio.stop();
  refreshBeatUi();
  if (!quiet) toast("Beat sync off");
}

async function startBeat(source: AudioSource): Promise<void> {
  if (settings.beatSource !== source) update({ beatSource: source });
  if (source === "system") {
    toast("In the share window: pick Entire screen and tick \"Also share system audio\" (or share the tab playing music).", 9000);
  }
  try {
    await audio.start(source, settings.beatSensitivity);
    toast(
      source === "system"
        ? "Beat sync on. Only the sound is used; the screen picture is thrown away right away."
        : "Beat sync on. Play the music out loud near this device.",
      4500,
    );
  } catch (err) {
    if (err instanceof SupersededError) {
      // A newer click or "Off" took over while the browser was asking; its stream is already stopped.
    } else if (err instanceof NoAudioSharedError) {
      toast("No sound was shared. Try again and tick \"Also share system audio\" (Chrome or Edge on a computer).", 7000);
    } else if ((err as Error).name === "NotAllowedError") {
      toast(source === "system" ? "Sharing was cancelled." : "Microphone permission was denied.", 4000);
    } else {
      toast(source === "system" ? "This browser can't share its sound. Try the microphone instead." : "Couldn't use the microphone.", 5000);
    }
  }
  refreshBeatUi();
}

/** The Beat button / B key: off if on, otherwise start with the preferred source. */
async function toggleBeat(source: AudioSource = settings.beatSource): Promise<void> {
  if (audio.active) return stopBeat();
  await startBeat(source);
}

// Always stop, even while a mic or share prompt is still open, so "Off" cancels it too.
beatOff.addEventListener("click", () => stopBeat(!audio.active));
beatSystem.addEventListener("click", () => audio.source !== "system" && void startBeat("system"));
beatMic.addEventListener("click", () => audio.source !== "mic" && void startBeat("mic"));

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("Full screen isn't available here.");
  }
}

function nudgeLyrics(deltaMs: number): void {
  update({ lyricOffsetMs: settings.lyricOffsetMs + deltaMs });
  const s = (settings.lyricOffsetMs / 1000).toFixed(1);
  toast(settings.lyricOffsetMs === 0 ? "Lyric timing: normal" : `Lyric timing: ${settings.lyricOffsetMs > 0 ? "+" : ""}${s}s earlier`);
}

btnMic.addEventListener("click", () => void toggleBeat());
btnFull.addEventListener("click", () => void toggleFullscreen());
/**
 * Leave the visualizer: stop asking Spotify, turn beat sync off (mic or computer sound) and
 * let the screen sleep. The login screen hides the Beat controls, so this must happen first.
 */
function endSession(): void {
  poller?.stop();
  stopBeat(true);
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

btnLogout.addEventListener("click", () => {
  endSession();
  auth.logout();
  showLogin(undefined, true);
});

window.addEventListener("keydown", (e) => {
  // Shortcuts are off on the login screen and while the settings dialog is open.
  if (!panel.hidden || settingsDialog.open || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === " ") {
    e.preventDefault(); // don't scroll or press a focused button
    tapBeat();
    return;
  }
  if (k === "l") toggleLyrics();
  else if (k === "s") openSettings();
  else if (k === "v") cycleStyle();
  else if (k === "t") cycleFont();
  else if (k === "a") cycleAnim();
  else if (k === "k") toggleKaraoke();
  else if (k === "b") void toggleBeat();
  else if (k === "m") void toggleBeat("mic");
  else if (k === "f") void toggleFullscreen();
  else if (k === "]") nudgeLyrics(100);
  else if (k === "[") nudgeLyrics(-100);
  else if (k === "0") nudgeLyrics(-settings.lyricOffsetMs);
});

applySettings(false);

// Hide the controls and cursor when the mouse is still.
let idleTimer = 0;
function wake(): void {
  hud.classList.remove("idle");
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!hud.hidden) {
      hud.classList.add("idle");
      document.body.classList.add("idle");
    }
  }, 3500);
}
["pointermove", "pointerdown", "keydown"].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));

// Keep the screen awake while visualizing (phones, TVs).
let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    if (nav.wakeLock && document.visibilityState === "visible") wakeLock = await nav.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !hud.hidden) void keepAwake();
});

// ---------- start ----------

function showFramed(): void {
  const open = h("a", { className: "button", href: location.href, target: "_blank", rel: "noopener noreferrer" }, "Open Lyric Lights");
  showPanel(
    h("h1", {}, "Lyric Lights"),
    h("p", {}, "For your safety, Lyric Lights doesn't run inside other websites."),
    h("div", { className: "row" }, open),
  );
}

/**
 * The service worker (public/sw.js) only shows an offline page when there's no connection.
 * Production builds only: the dev server reloads too often for it to be useful.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
}

// ---------- Android live wallpaper ----------

const gate = new FrameGate(QUALITIES.balanced.fps);
let quality: Quality = "balanced";
let wallpaperVisible = true;

/** Wallpaper mode: should this frame be drawn? Fewer frames on the clock screen, none while hidden. */
function wallpaperFrame(now: number): boolean {
  if (!wallpaperVisible) return false;
  gate.fps = viz.idle ? IDLE_FPS : QUALITIES[quality].fps;
  return gate.shouldDraw(now);
}

function startAndroidWallpaper(): void {
  document.body.classList.add("android-wallpaper");
  panel.hidden = true;
  hud.hidden = true;
  hint.hidden = true;
  viz.idleHint = "Play some music";
  viz.maxDpr = QUALITIES[quality].maxDpr;
  // Wallpaper defaults: calmer motion, no Up next card (the media controls don't share the queue).
  settings = parseSettings({ ...settings, showUpNext: false, kickMotion: "subtle" }, settings);
  applySettings(false);
  // Show the clock until the app says what's playing.
  onPlayback({ ...NOTHING_PLAYING, at: performance.now() });

  window.addEventListener("message", (e) => {
    if (!isFromHost(e)) return;
    const msg = parseHostMessage(e.data);
    if (!msg) return;
    if (msg.type === "playback") {
      onPlayback({ ...msg.playback, at: performance.now() });
    } else if (msg.type === "settings") {
      quality = msg.quality;
      viz.maxDpr = QUALITIES[quality].maxDpr;
      settings = parseSettings({ ...settings, ...msg.settings }, settings);
      applySettings(false);
    } else if (msg.type === "visible") {
      wallpaperVisible = msg.visible;
      gate.reset();
    }
  });
}

async function start(): Promise<void> {
  // Refuse to run inside another site's frame (clickjacking). See frame.ts.
  if (isFramed()) return showFramed();
  if (isAndroidWp) {
    requestAnimationFrame(loop);
    return startAndroidWallpaper();
  }
  registerServiceWorker();

  auth.removeLegacyTokens();
  requestAnimationFrame(loop);

  if (isDemo) {
    demo = createDemo();
    showVisualizer();
    void keepAwake();
    wake();
    toast("Demo mode: made-up songs, no Spotify needed", 3500);
    return;
  }

  const clientId = auth.getClientId();
  if (!clientId) return showSetup();

  const redirect = await auth.handleRedirect(clientId);
  if (redirect.kind === "error") return showLogin(redirect.message);
  if (!auth.isLoggedIn()) return showLogin();

  showVisualizer();
  void keepAwake();
  wake();
  hint.hidden = false;
  hint.textContent = "Connecting to Spotify…";

  poller = new SpotifyPoller({
    getToken: () => auth.getAccessToken(clientId),
    onRefreshNeeded: () => auth.forceRefresh(clientId),
    onPlayback,
    onQueue: (next) => setNext(next),
    onError: (msg) => {
      if (msg) toast(msg, 5000);
    },
    onLoggedOut: () => {
      endSession();
      showLogin("Your Spotify session ended. Please connect again.");
    },
  });
  poller.start();
}

void start();
