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
    await ctx.addInitScript(() => {
      if (!localStorage.getItem("sv.clientId")) {
        localStorage.setItem("sv.clientId", "0123456789abcdef0123456789abcdef");
        localStorage.setItem("sv.tokens", JSON.stringify({ accessToken: "fake", refreshToken: "fake-r", expiresAt: Date.now() + 3600e3 }));
      }
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
    check(authHeader === "Bearer fake", "spotify: sends the access token");
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
    await page.screenshot({ path: `${OUT}login.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
