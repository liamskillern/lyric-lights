# Lyric Lights

📱 **Android:** installable from Chrome today; Google Play app in [docs/ANDROID.md](docs/ANDROID.md).

📱 **Android live wallpaper:** the visualizer behind your home screen icons, no Spotify login needed. See [docs/ANDROID_WALLPAPER.md](docs/ANDROID_WALLPAPER.md).

A live visualizer for whatever you're playing on Spotify. Play a song on any device and this page turns it into light:

- **Album art → colors.** The cover is quantized into a palette (median cut, written from scratch) that drives the background, glow and particles.
- **Lyrics → imagery.** Time-synced lyrics come from [LRCLIB](https://lrclib.net). Each line is scanned for themes: rain, fire, night, snow, gold, love, city, nature. Those themes switch on matching effects (rain streaks, rising embers, stars, snow, sparkles, soft glow, neon streaks, petals) at the moment the line is sung.
- **Lyric mood → tone.** Each line gets a sentiment score (AFINN word list). Happy songs are warmer and brighter, sad ones cooler and darker.
- **Lyric speed → motion.** Words per minute, measured from the lyric timestamps, sets how fast everything moves. Fast rap moves; ballads drift.
- **Beat → pulse (optional).** Spotify's audio is DRM-protected, so the page can't read it directly. In Chrome or Edge on a computer it can listen to the **computer's sound** through the screen-share prompt ("Also share system audio"; the picture is thrown away). On phones it uses the mic. Bass, mids and treble drive the glow, brightness and sparkle; flashes are capped at 3 per second (WCAG 2.3.1).
- **Tempo → speed.** BPM is heard from the beat (median of beat gaps) or guessed from lyric timing (how line starts fit a bar grid). Faster songs move faster; "~" marks a guess.
- **Beat pulse.** A beat clock keeps a steady pulse at the song's tempo, so the whole background breathes on every beat, harder on each bar's first beat. The beat comes from beat sync (phase-locked to the detected kicks), from tapping **Space** along with the song, or from the lyric-timing guess. A dot next to the BPM blinks in time. Brightness changes stay under 10% (WCAG flash threshold).
- **Kick motion.** The background rides the drums: kicks punch in and push it around in turn (down, left, up, right), snares shake it sideways, all on springs with a small bounce, capped at ~4% of the screen. The lyrics stay still.
- **Fonts** (`T`): Modern, Poster, Elegant, Marker, Retro, Mono, or Auto (picked per song). Self-hosted, so no font service is contacted.
- **Lyric animations** (`A`): Rise, Fade, Pop, Slide, Typewriter, Karaoke words.
- **Karaoke mode** (`K`): three lines, words fill as they're sung (real word timings when the lyrics have them), countdown dots before you come in.
- **Chorus moments.** Repeated lyric lines are detected as the chorus. Choruses get brighter, faster and bigger, with a sparkle burst when they start.
- **Four styles** (`V`): Glow, Aurora, Vinyl (the cover as a spinning record) and Tunnel.
- **Up next + progress.** A progress line, the time, and an "Up next" card from your Spotify queue near the end of each song.
- **Idle screensaver.** When nothing's playing: calm aurora light with a slowly drifting clock (no burn-in).
- **Settings** (`S`): style, effect strength, reduced motion, lyric size and timing, beat source and sensitivity.

![Lyric Lights showing a rain lyric](docs/preview.png)

**[Watch the demo](https://liamskillern.github.io/lyric-lights/?demo)** (made-up songs, no Spotify account needed).

📄 **[Full project report](docs/REPORT.md)**: every feature, setting, key, data source, security measure, limit and troubleshooting tip.

## How it works

```
Spotify Web API ──(poll every 1.5 s)──► now playing + position
        │                                      │
        ▼                                      ▼
  album art URL                        LRCLIB synced lyrics
        │                                      │
  median-cut palette                 sentiment + themes + words/min
        └──────────────► scene.ts ◄────────────┘
                     (the "director": song data → visual targets)
                               │
                 canvas renderer eases toward the targets every frame
```

There is no backend. The page logs in with **Authorization Code + PKCE**, so it never needs a client secret, and it talks straight to Spotify and LRCLIB.

| File | What it does |
|---|---|
| `src/auth.ts` | PKCE login, CSRF `state` check, token refresh |
| `src/spotify.ts` | Polls "currently playing", estimates the position between polls, backs off on 429 |
| `src/lyrics.ts` | LRCLIB lookup with fuzzy fallback, LRC parser, binary search for the current line |
| `src/palette.ts` | Median-cut quantizer and palette roles (vibrant, secondary, dark, light) |
| `src/mood.ts` | Line sentiment, theme keywords, words per minute |
| `src/scene.ts` | Maps everything to colors, speed, brightness and effect levels |
| `src/audio.ts` | Beat detection and bass/mid/treble from computer sound or the mic, flash limiter |
| `src/tempo.ts` | Tempo from beats or from lyric timing |
| `src/beatClock.ts` | Phase-locked beat clock, tap tempo, pulse shape |
| `src/fonts.ts` | Self-hosted fonts and the Auto font pick |
| `src/render/camera.ts` | Spring "camera" that moves with kicks and snares |
| `src/render/lyricAnim.ts`, `karaoke.ts` | Lyric animations, word fill, countdowns |
| `src/settings.ts` | Settings with validation (stored values are untrusted) |
| `src/androidWallpaper.ts` | `?android-wallpaper` mode for the Android live wallpaper: song data from the app, frame cap |
| `src/render/styles/` | The four visual styles |
| `src/render/` | Particle effects, lyric typography, idle screen |

## Security and privacy

- **PKCE + `state`:** no client secret ships in the page, and a login started by another site is rejected.
- **Least privilege:** the only scopes are `user-read-currently-playing` and `user-read-playback-state` (read-only).
- **Token storage:** every GitHub Pages site under `<user>.github.io` shares one browser storage area, so nothing long-lived goes in `localStorage`. The access token stays in memory; the refresh token sits in `sessionStorage` for this tab only and is gone when the tab closes.
- **Clickjacking guard:** GitHub Pages can't send the `frame-ancestors` header, so the page checks whether it's inside a frame and refuses to start (`src/frame.ts`).
- **Content-Security-Policy** (production build): scripts and styles only from this site, no inline styles, network calls only to Spotify and LRCLIB, images only from Spotify's CDNs, no frames or workers.
- **Untrusted data:** song titles, lyrics and login error codes are never inserted as HTML. Unknown `?error=` values get a fixed message, so a crafted link can't put its own words on the page. LRCLIB responses are type-checked and capped (1 MB response, 2,000 lines, 300 characters per line).
- **Supply chain:** GitHub Actions are pinned to commit hashes, the checkout doesn't leave the token on disk, and Dependabot proposes weekly updates.
- **Audio:** computer sound or mic audio is analyzed live in the browser and never recorded or sent anywhere. With computer sound, the screen picture the browser hands over is stopped immediately and never drawn.
- **Revoking access:** "Log out" clears the tab. To cut the app off from your Spotify account completely, remove it at [spotify.com/account/apps](https://www.spotify.com/account/apps/).

## Run it yourself

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and tick **Web API**.
2. Add the Redirect URIs `http://127.0.0.1:5173/` (local) and `https://<you>.github.io/lyric-lights/` (deployed). Spotify doesn't accept `localhost`; use `127.0.0.1`.
3. Under **User Management**, add the Spotify accounts that will use it. New apps run in development mode, which only works for accounts listed there (up to 5 since February 2026), and the app owner needs Spotify Premium.
4. Run it:

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173/ and paste your Client ID when asked, or put it in `.env` as `VITE_SPOTIFY_CLIENT_ID` (see `.env.example`). The Client ID isn't a secret.

**Keys:** `Space` tap the beat · `B` beat sync · `M` beat from the mic · `V` next style · `T` next font · `A` next lyric animation · `K` karaoke mode · `S` settings · `L` lyrics on/off · `F` full screen · `[` / `]` nudge lyric timing (useful with Bluetooth delay) · `0` reset timing.

## Tests

```bash
npm test          # unit tests (Vitest): LRC parsing, PKCE, palette, mood, scene, beat detector
npm run e2e       # browser checks (Playwright) against the production build, with Spotify mocked
```

`npm run e2e` needs Playwright: `npm i -D playwright && npx playwright install chromium`.

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `main`. Turn on Pages under **Settings → Pages → Source: GitHub Actions**. Optionally, set a repository variable `SPOTIFY_CLIENT_ID` so visitors skip the setup step.

## Limits

- Spotify stopped giving new apps tempo, energy and beat data (Nov 2024), so mood comes from the lyrics and the beat comes from the mic.
- Not every song is on LRCLIB. Without synced lyrics, the visuals use the colors plus whatever mood and themes the plain lyrics or the title give.

Not affiliated with or endorsed by Spotify. Lyrics come from LRCLIB.
