# Lyric Lights as an Android live wallpaper

The Android app (1.1.0 and later) includes a **live wallpaper**: the visualizer runs behind your
home screen icons and follows whatever you're playing.

- **No Spotify login.** It reads the song from Android's media controls (the player on your lock
  screen), so it works with Spotify and most other music apps. Spotify's 5-user development limit
  doesn't apply.
- **The same visuals as the app.** All four styles, synced lyrics, karaoke, chorus moments and the
  beat pulse (from the tempo guessed from lyric timing).
- **It only draws while the home screen is showing.** It stops completely when an app is open or
  the screen is off.

## Set it up on your Pixel

1. **Build and install the app** (see [Build](#build) below), or install the next Play release.
2. Open **Lyric Lights Wallpaper**, the second launcher icon the app adds.
3. **Allow access** → turn on *Lyric Lights Wallpaper* → confirm.
   - **Greyed out, or "Restricted setting"?** Android 13+ blocks this for apps installed from an
     APK file. Tap **Open app info** → **⋮** (top right) → **Allow restricted settings**, then try
     again. Play Store installs don't have this step.
4. Pick a **style** and a **quality** (see [Battery](#battery)).
5. **Set wallpaper** → *Home screen* (or *Home and lock screens*).

To change settings later, use the launcher icon or the gear in **Wallpaper & style → Live wallpapers**.

## How it works

```
Spotify / any player ──► Android media session ──► NowPlaying.java ──(postWebMessage, JSON)──► page
                          (title, artist, art,        (push callbacks,                       ?android-wallpaper
                           position, play/pause)       no polling)                           src/androidWallpaper.ts
                                                                                                  │
LRCLIB ◄───────────────────────── lyrics lookup ─────────────────────────────────────────────────┘
```

| File | What it does |
|---|---|
| `wallpaper/LyricLightsWallpaperService.java` | The wallpaper. Runs a WebView on a private `VirtualDisplay` that draws into the wallpaper's surface, and pauses it whenever the wallpaper is hidden. |
| `wallpaper/NowPlaying.java` | Follows the active media session, picks the one that's playing, and encodes the album art once per song (320 px JPEG). |
| `wallpaper/MediaListenerService.java` | An empty notification listener. Android requires one before an app may read media sessions. |
| `wallpaper/WallpaperSettingsActivity.java` | The setup screen. |
| `src/androidWallpaper.ts` | Page side: checks every message from the app, and caps the frame rate. |

(Java files are under `android/app/src/main/java/io/github/liamskillern/lyriclights/`.)

`?android-wallpaper` is not the same as `?wallpaper` (the Windows desktop wallpaper, which logs in
to Spotify itself). The Android mode never contacts Spotify at all.

## Battery

| Quality | Frames per second | Sharpness | Use it when |
|---|---|---|---|
| Battery saver | 20 | 1× pixels | You want the smallest drain |
| **Balanced** (default) | 30 | 1.5× pixels | Most of the time |
| Sharp | 60 | 2× pixels | You don't mind charging more often |

- When nothing is playing, the clock screen draws at 5 fps whatever the setting.
- When the home screen isn't showing (an app is open, the screen is off, the lock screen without
  this wallpaper) the WebView is hidden and paused, and nothing draws. Expect the drain to be in
  line with how long you look at your home screen.
- The microphone is never used. Android doesn't allow it in the background anyway.
- To check it on your phone: **Settings → Battery → Battery usage**, and look for Lyric Lights
  after a day.

## Security and privacy

- **The bundled site, not the live one.** The WebView loads a copy of the site built into the APK
  and served from `https://appassets.androidplatform.net/lyric-lights/`. Nothing runs that didn't
  ship with the app, and the production Content-Security-Policy applies unchanged (scripts only
  from the app itself, network calls only to LRCLIB and Spotify).
- **Locked-down WebView.** No file or content-provider access, no JavaScript bridge
  (`addJavascriptInterface` isn't used), no pop-ups, no navigation away, microphone and camera
  requests denied. If the WebView's renderer crashes, the wallpaper rebuilds it instead of crashing.
- **One-way, checked messages.** The app sends JSON with `WebView.postWebMessage` to its own
  origin only. The page accepts only messages with no source window (which is how the app's
  messages arrive, and which scripts on the page can't fake with `postMessage`), and validates
  everything: text is capped, numbers are clamped, and album art must be a small base64 JPEG, PNG or
  WebP `data:` URL.
- **Notification access, used narrowly.** Android calls the permission "notification access",
  but `MediaListenerService` doesn't override any notification callback, so notification content
  is never read. A unit test (`tests/android.test.ts`) fails if that ever changes. Both services
  can only be bound by the system (`BIND_WALLPAPER`, `BIND_NOTIFICATION_LISTENER_SERVICE`).
- **What leaves the phone:** the song's title, artist, album and length go to LRCLIB, as in the
  app. The [privacy policy](../public/privacy.html) covers the wallpaper.

## Build

Needs Node 22, JDK 17+ and Android SDK 36 (Android Studio includes both).

```bash
npm ci
npm run build:android        # builds the site for /lyric-lights/ into dist/
cd android
./gradlew assembleRelease    # or bundleRelease for Play; copies dist/ into the APK as assets/web
```

Unlike the app, **website changes reach the wallpaper only with a new app build**, because it runs
the bundled copy.

The Gradle build stops with a clear message if `dist/` is missing or was built for the wrong path.
Sign the APK or AAB as described in [ANDROID.md](ANDROID.md#updating-the-android-app-later). This
release is **1.1.0 (versionCode 2)**.

## Limits

- **Beat sync:** the pulse uses the tempo guessed from lyric timing. The microphone and computer
  sound aren't available to a wallpaper.
- **No Up next card:** media sessions don't share the queue reliably.
- **Album art:** some players send the art a moment after the title. The colors update when it
  arrives.
- **Several players at once:** the wallpaper shows the one that's playing, or else the most recent.
- **Not tested on every phone.** It's built on public Android APIs (API 24+), but it has only been
  checked in a browser and compiled against the Android 16 SDK from the cloud. Try it on your Pixel
  first.
