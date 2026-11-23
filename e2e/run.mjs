// End-to-end check in a real browser (Playwright + Chromium), against the production
// build with its Content-Security-Policy. Spotify and LRCLIB are mocked, so no account
// or network access is needed.
//
//   npm run build && node e2e/run.mjs
//
// Screenshots land in e2e/screenshots/.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// require() so a globally installed Playwright works too (npm i -D playwright otherwise).
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Run vite's own script with node (not via npx) so server.kill() stops the real server.
const viteBin = new URL("../node_modules/vite/bin/vite.js", import.meta.url).pathname;
const server = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && resolve());
  server.on("exit", (c) => reject(new Error(`preview exited ${c}`)));
  setTimeout(() => reject(new Error("preview didn't start")), 15000);
});

const browser = await chromium.launch();
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return errors;
}

/** Average color of a region of the canvas, to prove something is being drawn. */
async function canvasStats(page) {
  return page.evaluate(() => {
    const c = document.getElementById("stage");
    const tmp = document.createElement("canvas");
    tmp.width = 64;
    tmp.height = 64;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] + d[i + 1] + d[i + 2];
      sum += v;
      if (v > max) max = v;
    }
    return { avg: sum / (d.length / 4) / 3, max: max / 3 };
  });
}

try {
  // ---- 1. Setup screen (no client id yet) ----
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = watchErrors(page);
    await page.goto(BASE);
    await page.waitForSelector(".card h1");
    check(await page.isVisible("text=Add this Redirect URI exactly"), "setup screen explains the redirect URI");
    check((await page.textContent(".copy-row code")) === BASE, "setup shows this page's redirect URI");
    await page.fill("input[type=text]", "not-an-id");
    await page.click("text=Save and connect");
    check(await page.isVisible("text=doesn't look like a Client ID"), "rejects a bad client id");
    await page.screenshot({ path: `${OUT}setup.png` });
    check(errors.length === 0, `setup: no console errors ${errors.join(" | ")}`);
    await page.close();
  }

  // ---- 2. Demo mode ----
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = watchErrors(page);
    await page.goto(`${BASE}?demo`);
    await page.waitForFunction(() => document.getElementById("np-title")?.textContent === "Neon Weather");
    check(true, "demo: first song shows in the now-playing box");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}demo-title.png` });
    await page.waitForTimeout(3600); // ~5.1 s: "Midnight on the highway, city lights…"
    await page.screenshot({ path: `${OUT}demo-city-night.png` });
    const s1 = await canvasStats(page);
    check(s1.max > 150, `demo: canvas has bright content (max ${s1.max.toFixed(0)})`);
    await page.waitForTimeout(4000); // ~9 s: rain line
    await page.screenshot({ path: `${OUT}demo-rain.png` });
    await page.waitForTimeout(17500); // ~26.6 s: "Light a little fire…"
    await page.screenshot({ path: `${OUT}demo-fire.png` });
    check(errors.length === 0, `demo: no console errors ${errors.join(" | ")}`);
    await page.close();
  }

  // ---- 3. Phone-sized demo ----
  {
    const ctx = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await ctx.newPage();
    await page.goto(`${BASE}?demo`);
    await page.waitForTimeout(5200);
    await page.screenshot({ path: `${OUT}demo-phone.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, "phone: no horizontal scroll");
    await ctx.close();
  }

  // ---- 4. Logged-in flow with mocked Spotify + LRCLIB ----
  {
    // Make a fake album cover PNG.
    const maker = await browser.newPage();
    const pngB64 = await maker.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 300;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, 300, 300);
      g.addColorStop(0, "#ff7a00");
      g.addColorStop(1, "#5a00b4");
      x.fillStyle = g;
      x.fillRect(0, 0, 300, 300);
      x.fillStyle = "#00e1ff";
      x.beginPath();
      x.arc(150, 150, 70, 0, Math.PI * 2);
      x.fill();
      return c.toDataURL("image/png").split(",")[1];
    });
    await maker.close();
    const png = Buffer.from(pngB64, "base64");

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    // A tab that already logged in: refresh token in sessionStorage. Plus tokens left in
    // localStorage by the old version, which the app must delete.
    await ctx.addInitScript(() => {
      if (!localStorage.getItem("sv.clientId")) {
        localStorage.setItem("sv.clientId", "0123456789abcdef0123456789abcdef");
        localStorage.setItem("sv.tokens", JSON.stringify({ accessToken: "old", refreshToken: "old-r", expiresAt: Date.now() + 3600e3 }));
        sessionStorage.setItem("sv.refresh", "fake-r");
      }
    });
    let tokenRequests = 0;
    await ctx.route("https://accounts.spotify.com/api/token", (route) => {
      tokenRequests++;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ access_token: "fake-access", refresh_token: "fake-r2", expires_in: 3600 }),
      });
    });
    const started = Date.now();
    let spotifyCalls = 0;
    let authHeader = "";
    await ctx.route("https://api.spotify.com/**", (route) => {
      spotifyCalls++;
      authHeader = route.request().headers()["authorization"] ?? "";
      route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({
          is_playing: true,
          progress_ms: 2000 + (Date.now() - started),
          currently_playing_type: "track",
          item: {
            id: "track-1",
            name: "Fireworks Over Water",
            duration_ms: 180000,
            artists: [{ name: "Test Artist" }],
            album: { name: "Test Album", images: [{ url: "https://i.scdn.co/image/test640", width: 640, height: 640 }, { url: "https://i.scdn.co/image/test64", width: 64, height: 64 }] },
          },
        }),
      });
    });
    await ctx.route("https://i.scdn.co/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: png }),
    );
    let lrclibQuery = "";
    await ctx.route("https://lrclib.net/**", (route) => {
      lrclibQuery = route.request().url();
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          trackName: "Fireworks Over Water",
          artistName: "Test Artist",
          duration: 180,
          instrumental: false,
          plainLyrics: "x",
          syncedLyrics: "[00:01.00]Fire in the sky tonight\n[00:04.00]Burning over the ocean waves\n[00:30.00]end",
        }),
      });
    });

    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(BASE);
    await page.waitForFunction(() => document.getElementById("np-title")?.textContent === "Fireworks Over Water");
    check(tokenRequests === 1, `auth: gets an access token from the refresh token (${tokenRequests} request)`);
    check(authHeader === "Bearer fake-access", "spotify: sends the access token");
    const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    check(!JSON.stringify(stored.local).includes("fake") && !("sv.tokens" in stored.local), "storage: no tokens in localStorage (old ones deleted)");
    check(JSON.stringify(stored.session) === JSON.stringify({ "sv.refresh": "fake-r2" }), "storage: only the rotated refresh token in sessionStorage");
    check((await page.textContent("#np-artist")) === "Test Artist", "spotify: shows the artist");
    await page.waitForFunction(() => document.getElementById("np-status")?.textContent === "");
    check(true, "lyrics: synced lyrics found (status cleared)");
    check(lrclibQuery.includes("track_name=Fireworks") && lrclibQuery.includes("duration=180"), "lyrics: LRCLIB queried by track and duration");
    check((await page.getAttribute("#thumb", "src")) === "https://i.scdn.co/image/test64", "art: thumbnail uses the small image");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}spotify-mocked.png` });
    const s = await canvasStats(page);
    check(s.max > 150, `spotify: canvas drawing (max ${s.max.toFixed(0)})`);
    check(spotifyCalls >= 2, `spotify: keeps polling (${spotifyCalls} calls)`);
    check(errors.length === 0, `spotify: no console errors ${errors.join(" | ")}`);

    // Log out returns to the login screen.
    await page.mouse.move(10, 10);
    await page.click("#btn-logout");
    await page.waitForSelector("text=Connect Spotify");
    check(true, "logout returns to the login screen");
    check(await page.isVisible("a[href='https://www.spotify.com/account/apps/']"), "logout: shows where to remove access at Spotify");
    const after = await page.evaluate(() => ({ ...sessionStorage, ...localStorage }));
    check(!JSON.stringify(after).includes("fake"), "logout: no tokens left in storage");
    await page.screenshot({ path: `${OUT}login.png` });
    await ctx.close();
  }

  // ---- 5. Clickjacking: inside another site's frame the app refuses to run ----
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.setContent(`<h1>evil.example</h1><iframe src="${BASE}?demo" width="900" height="500"></iframe>`);
    const frame = await (await page.waitForSelector("iframe")).contentFrame();
    await frame.waitForSelector("text=doesn't run inside other websites");
    check(true, "framed: shows the refusal message");
    check(await frame.isHidden("#hud"), "framed: controls never appear");
    check((await frame.textContent("#np-title")) === "", "framed: the app didn't start");
    await page.screenshot({ path: `${OUT}framed.png` });
    await page.close();
  }

  // ---- 6. Text injection through ?error= ----
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => localStorage.setItem("sv.clientId", "0123456789abcdef0123456789abcdef"));
    const page = await ctx.newPage();
    await page.goto(`${BASE}?error=${encodeURIComponent("Your account is hacked. Call 555-0100")}&state=x`);
    await page.waitForSelector(".card .error");
    const msg = await page.textContent(".card .error");
    check(msg === "Login failed. Please try again.", `error link: shows fixed text ("${msg}")`);
    check(!(await page.content()).includes("555-0100"), "error link: attacker's text isn't on the page");
    check(!page.url().includes("error="), "error link: removed from the address bar");
    await ctx.close();
  }

  // ---- 7. Beat sync with Chromium's fake mic and fake screen share ----
  {
    const b2 = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-accept-this-tab-capture", "--auto-select-desktop-capture-source=Entire screen"],
    });
    const page = await b2.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = watchErrors(page);
    await page.goto(`${BASE}?demo`);
    await page.waitForFunction(() => document.getElementById("np-title")?.textContent !== "");
    // Mic (M): the fake device plays a beep, so the button should turn on.
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.getElementById("btn-mic")?.getAttribute("aria-pressed") === "true", null, { timeout: 5000 }).catch(() => {});
    check((await page.getAttribute("#btn-mic", "aria-pressed")) === "true", "beat: mic turns on");
    await page.waitForTimeout(1500);
    await page.keyboard.press("m");
    check((await page.getAttribute("#btn-mic", "aria-pressed")) === "false", "beat: turns off again");
    // System audio (B): headless Chromium shares a screen with no sound, so expect the friendly message.
    await page.keyboard.press("b");
    await page.waitForTimeout(2000);
    const toastText = await page.textContent("#toast");
    const pressed = await page.getAttribute("#btn-mic", "aria-pressed");
    check(pressed === "true" || /No sound was shared|can't share|cancelled/.test(toastText ?? ""), `beat: system audio on, or a clear message ("${toastText}")`);
    check(errors.length === 0, `beat: no console errors ${errors.join(" | ")}`);
    await b2.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
