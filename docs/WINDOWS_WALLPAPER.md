# Lyric Lights as a Windows 11 wallpaper

Lyric Lights can run as your animated desktop background, behind your icons. Two wallpaper apps
work:

- **[Wallpaper Engine](#wallpaper-engine)** (Steam): a small package in `wallpaper-engine/`.
- **[Lively Wallpaper](#lively-wallpaper)** (free, open source): just a URL.

Either way the wallpaper is the live site in wallpaper mode:

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
| Style picked with `V` | Also settable in the address: `&style=glow`, `aurora`, `vinyl` or `tunnel` |

When nothing is playing, the calm idle screen with the drifting clock takes over, which makes a
good wallpaper on its own.

## Wallpaper Engine

Wallpaper Engine passes mouse clicks to a web wallpaper but never the keyboard, so you can't type
your Spotify password into it. Instead you log in once in your normal browser and give the
wallpaper a **pairing code**.

### Set it up (about 5 minutes)

1. **Get the package.** Download this repository (green **Code** button → **Download ZIP**) and
   unzip it, or `git clone` it. You only need the `wallpaper-engine` folder.
2. **Add it to Wallpaper Engine.** Open Wallpaper Engine, click **Open Wallpaper** (bottom left)
   → **Open from file**, and pick `wallpaper-engine\project.json`. Lyric Lights shows up in your
   library; select it to apply. You'll see the "Connect Spotify" card for now.
3. **Make a pairing code.** In Chrome or Edge, open
   [liamskillern.github.io/lyric-lights/?pair](https://liamskillern.github.io/lyric-lights/?pair),
   click **Log in and make a code**, and log in to Spotify. Click **Copy code**.
4. **Paste it.** In Wallpaper Engine, with Lyric Lights selected, paste the code into
   **Spotify pairing code** in the panel on the right. The wallpaper reloads and connects. Close
   the browser tab.
5. **Play something** on any device. The wallpaper follows it.

The same panel has **Frame rate** (30 fps by default) and **Style** (Glow, Aurora, Vinyl,
Tunnel). Other settings (font, lyric size, effect strength) need the keyboard, so they stay at
their defaults in Wallpaper Engine.

How the code gets there: `wallpaper-engine/index.html` reads the wallpaper's settings and opens
the live site as `?wallpaper&fps=30#pair=<code>`. The part after `#` is never sent to any server,
and the site wipes it from the address bar as soon as it's read. Spotify replaces the login token
from time to time, so the wallpaper only takes a code it hasn't seen before; pasting the same code
again later does nothing. If the wallpaper ever shows the login card again, make a new code.

### Recommended Wallpaper Engine settings

- **Settings → Performance → Other application focused / maximized / full screen: Pause.** Games
  and videos get the GPU back.
- **Settings → Performance → Laptop on battery: Pause** (the Acer laptop).
- With two monitors, apply it to each one, or use **Display → Span** under the monitor picker.
  Each copy polls Spotify on its own.

### If it stays on a dark screen

Wallpaper Engine must let the package open the live site. If it doesn't (a future Wallpaper
Engine update could block that), the wallpaper stays dark after about 2 seconds. Use Lively
instead, or open an issue.

## Lively Wallpaper

### Set it up (about 5 minutes)

1. **Install Lively.** From the Microsoft Store (search "Lively Wallpaper"), or in a terminal:
   `winget install rocksdanister.LivelyWallpaper`
2. **Add the wallpaper.** Open Lively, click **+** (Add wallpaper), paste the URL above into the
   "Enter URL" box and press the arrow. Name it "Lyric Lights" and set it as your wallpaper.
3. **Log in to Spotify once.** Lively can pass the keyboard through, so you log in on the
   wallpaper itself (no pairing code needed). The wallpaper shows the "Connect Spotify" card. To click it:
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

### Tuning (Lively)

- **Frame rate:** `?wallpaper&fps=60` for smoother motion on a strong GPU, `&fps=20` on the laptop.
- **Style, font, lyric size, effect strength:** these are the normal settings. Open them once with
  `S` (with Wallpaper input set to Keyboard, or in Preview) and they're remembered.
- **Lyric timing:** `[` and `]` nudge it if your speakers are on Bluetooth.

## Limits

- **Beat sync from computer sound isn't available.** It needs Chrome's screen-share prompt, which a
  wallpaper can't show. The pulse uses the tempo guessed from lyric timing instead (or tap `Space`).
- **Logging out:** there's no button in wallpaper mode. Remove the app at
  [spotify.com/account/apps](https://www.spotify.com/account/apps/); the wallpaper notices the next
  time its token is refreshed (within an hour) and goes back to the login card. That also cancels
  every pairing code you've made.
- **Spotify development mode:** your Spotify account must be listed under User Management in the
  developer dashboard, the same as for the normal site.

## Security

The normal site keeps the Spotify refresh token in `sessionStorage` only, because every site
under `liamskillern.github.io` shares one browser storage area. A wallpaper that logs out on every
reboot isn't usable, so wallpaper mode keeps it in `localStorage` (key `sv.wallpaper.refresh`).
Why that's acceptable here:

- Wallpaper Engine and Lively each run their own browser profile, separate from Chrome or Edge.
  The shared `github.io` storage area in that profile only holds pages you add as wallpapers.
- The token is read-only (`user-read-currently-playing`, `user-read-playback-state`): it can see
  what you're playing and nothing else.
- The normal app never reads or writes that key, so opening the site in your browser doesn't pick
  up a wallpaper login, and logging out clears both.
- Revoking the app at spotify.com/account/apps kills the token immediately.

**Pairing codes** are Spotify refresh tokens with the same read-only scopes. `?pair` makes a
separate login just for the wallpaper and shows its token once; nothing is saved in the browser
that made it. Wallpaper Engine keeps the code in its own settings file on your PC, so treat it like
a password: don't share screenshots of the settings panel. Revoking the app at
spotify.com/account/apps cancels it. A crafted link with someone else's `#pair=` code could only
make a wallpaper show *their* music: it can't read anything of yours.

Don't open `?wallpaper` in your everyday browser and log in there: that would leave a long-lived
token in the storage area shared with every other `liamskillern.github.io` page in that browser.

## Why the Wallpaper Engine package redirects instead of embedding

Wallpaper Engine's web wallpapers are local HTML files. Showing the site in an `<iframe>` from one
would trip Lyric Lights' clickjacking guard (`src/frame.ts`), and a local file can't be a Spotify
Redirect URI. So the package opens the real page as a top-level page instead, and login, the
Content-Security-Policy and every other protection work unchanged. Lively loads the URL directly.
