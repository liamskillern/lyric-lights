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

The Wallpaper Engine package is the whole app in one local `index.html` (about 850 KB, fonts
included). It runs from your PC and talks only to Spotify and LRCLIB, the same as the website.

Wallpaper Engine passes mouse clicks to a web wallpaper but never the keyboard, so you can't type
your Spotify password into it. Instead you log in once in your normal browser and give the
wallpaper a **pairing code**.

### Set it up (about 5 minutes)

1. **Download the package:**
   [lyric-lights-wallpaper-engine.zip](https://liamskillern.github.io/lyric-lights/lyric-lights-wallpaper-engine.zip).
   It's rebuilt by every deploy. To build it yourself instead, run `npm run build:wallpaper-engine`
   and use `dist-wallpaper-engine/lyric-lights/`.
2. **Put it where Wallpaper Engine looks.** In Steam, right-click Wallpaper Engine →
   **Manage → Browse local files**, open `projects\myprojects`, and unzip the download there. You
   should end up with `projects\myprojects\lyric-lights\` holding `index.html`, `project.json` and
   `preview.jpg`. If an older `lyric-lights` folder is there, replace it.

   Don't use **Open Wallpaper → Open from file** on `project.json`: that's for importing a single
   video or web page, and on a `.json` file it fails with "error getting model code".
3. **Apply it.** Restart Wallpaper Engine. In the **Installed** tab, single-click Lyric Lights and
   click **OK**. (Don't open it in the editor.) Your desktop shows the pairing instructions.
4. **Make a pairing code.** In Chrome or Edge, open
   [liamskillern.github.io/lyric-lights/?pair](https://liamskillern.github.io/lyric-lights/?pair),
   click **Log in and make a code**, and log in to Spotify. Click **Copy code**.
5. **Paste it.** Back in Wallpaper Engine, with Lyric Lights selected, paste the code into
   **Spotify pairing code** in the panel on the right. The wallpaper reloads and connects. Close
   the browser tab.
6. **Play something** on any device. The wallpaper follows it.

The same panel has **Frame rate** (30 fps by default) and **Style** (Glow, Aurora, Vinyl,
Tunnel); both apply straight away. Other settings (font, lyric size, effect strength) need the
keyboard, so they stay at their defaults in Wallpaper Engine.

About the code: it's `<Client ID>:<Spotify refresh token>`, because a token only works with the
app that issued it. Spotify replaces the token from time to time, so the wallpaper only takes a
code it hasn't seen before: Wallpaper Engine hands over the same code on every start, and that
mustn't undo the newer token. If the wallpaper ever shows the pairing instructions again, make a
new code.

### Recommended Wallpaper Engine settings

- **Settings → Performance → Other application focused / maximized / full screen: Pause.** Games
  and videos get the GPU back.
- **Settings → Performance → Laptop on battery: Pause** (the Acer laptop).
- With two monitors, apply it to each one, or use **Display → Span** under the monitor picker.
  Each copy polls Spotify on its own.

### Troubleshooting

- **"Aw, Snap!"** The first version of the package jumped from the local file to the website,
  and Wallpaper Engine's built-in browser can crash on that. Download the zip again (step 1) and
  replace the old folder: the current package never leaves the local file.
- **Stuck on "Connecting to Spotify…"** Make a new pairing code and paste it. If it still sticks,
  Spotify may be refusing requests from a local file; use Lively instead and open an issue.
- **Still crashing:** in Wallpaper Engine, lower **Frame rate** to 20, and try
  **Settings → General → Web browser → Disable GPU acceleration** (if your version has it).

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

## Why the Wallpaper Engine package is a local copy

Wallpaper Engine's web wallpapers are local HTML files. Showing the website in an `<iframe>` from
one would trip Lyric Lights' clickjacking guard (`src/frame.ts`), and jumping from the local file to
the website crashed Wallpaper Engine's browser ("Aw, Snap!"). So the package is the app itself,
built as one file (`TARGET=wallpaper-engine`, see `vite.config.ts`). It keeps a strict
Content-Security-Policy: only its own script and stylesheet (pinned by hash) run, and it can only
connect to Spotify and LRCLIB. It never opens the Spotify login page; the pairing code replaces
that. Lively loads the website's URL directly.
