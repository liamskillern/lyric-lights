# Lyric Lights as a Windows 11 wallpaper

Lyric Lights can run as your animated desktop background, behind your icons, using
[Lively Wallpaper](https://www.rocksdanister.com/lively/) (free and open source). Lively shows a
web page as the wallpaper, so the wallpaper is just the live site with `?wallpaper` added:

```
https://liamskillern.github.io/lyric-lights/?wallpaper
```

## What wallpaper mode changes

| Normal page | `?wallpaper` |
|---|---|
| Buttons, hints and pop-up messages | None; song card only, raised above the taskbar |
| Login forgotten when the tab closes | Login remembered across restarts (see [Security](#security)) |
| Keeps the screen awake | Never blocks the monitor from sleeping |
| Draws at your screen's refresh rate | Capped at 30 fps (`&fps=` 10 to 60) to save GPU and battery |

When nothing is playing, the calm idle screen with the drifting clock takes over, which makes a
good wallpaper on its own.

## Set it up (about 5 minutes)

1. **Install Lively.** From the Microsoft Store (search "Lively Wallpaper"), or in a terminal:
   `winget install rocksdanister.LivelyWallpaper`
2. **Add the wallpaper.** Open Lively, click **+** (Add wallpaper), paste the URL above into the
   "Enter URL" box and press the arrow. Name it "Lyric Lights" and set it as your wallpaper.
3. **Log in to Spotify once.** The wallpaper shows the "Connect Spotify" card. To click it:
   - In Lively, open **Settings → Wallpaper → Wallpaper input** and choose **Keyboard** (mouse and
     keyboard). Then minimize your windows (Win + D) and click the card on the desktop.
   - Or right-click the wallpaper in Lively's library and choose **Preview**, which opens it in a
     normal window, and log in there.

   Use your Spotify email and password (or a login code). "Continue with Google/Apple" may refuse
   to work inside an embedded browser. After logging in, set **Wallpaper input** back to **Mouse**
   or **Off** so clicks on the desktop go to your icons again.
4. **Play something** on any device. The wallpaper follows it.

No change in the Spotify developer dashboard is needed: the Redirect URI is the same page the
normal site uses.

### Recommended Lively settings

- **Performance → When another app is full screen: Pause.** Games and videos get the GPU back.
- **Performance → On battery: Pause** (the Acer laptop). The wallpaper still uses a little power.
- **Display → Screen layout**: "Span" stretches one wallpaper across both monitors, "Duplicate" puts
  a copy on each. Each copy polls Spotify on its own, so with more than two screens pick "Span".

### Tuning

- **Frame rate:** `?wallpaper&fps=60` for smoother motion on a strong GPU, `&fps=20` on the laptop.
- **Style, font, lyric size, effect strength:** these are the normal settings. Open them once with
  `S` (with Wallpaper input set to Keyboard, or in Preview) and they're remembered.
- **Lyric timing:** `[` and `]` nudge it if your speakers are on Bluetooth.

## Limits

- **Beat sync from computer sound isn't available.** It needs Chrome's screen-share prompt, which a
  wallpaper can't show. The pulse uses the tempo guessed from lyric timing instead (or tap `Space`).
- **Logging out:** there's no button in wallpaper mode. Remove the app at
  [spotify.com/account/apps](https://www.spotify.com/account/apps/); the wallpaper notices the next
  time its token is refreshed (within an hour) and goes back to the login card. Or open Preview and
  run the normal page there.
- **Spotify development mode:** your Spotify account must be listed under User Management in the
  developer dashboard, the same as for the normal site.

## Security

The normal site keeps the Spotify refresh token in `sessionStorage` only, because every site
under `liamskillern.github.io` shares one browser storage area. A wallpaper that logs out on every
reboot isn't usable, so wallpaper mode keeps it in `localStorage` (key `sv.wallpaper.refresh`).
Why that's acceptable here:

- Lively runs its own browser profile (WebView2), separate from Chrome or Edge. The shared
  `github.io` storage area in that profile only holds pages you add to Lively yourself.
- The token is read-only (`user-read-currently-playing`, `user-read-playback-state`): it can see
  what you're playing and nothing else.
- The normal app never reads or writes that key, so opening the site in your browser doesn't pick
  up a wallpaper login, and logging out clears both.
- Revoking the app at spotify.com/account/apps kills the token immediately.

Don't open `?wallpaper` in your everyday browser and log in there: that would leave a long-lived
token in the storage area shared with every other `liamskillern.github.io` page in that browser.

## Why Lively and not Wallpaper Engine

Wallpaper Engine's web wallpapers are local HTML files. Loading the live site from one would mean
putting it in an `<iframe>`, which Lyric Lights refuses on purpose (clickjacking guard,
`src/frame.ts`), and a local file can't be a Spotify Redirect URI. Lively loads the real page as a
top-level page, so login, the Content-Security-Policy and every other protection work unchanged.
