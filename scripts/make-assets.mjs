// Makes the app icons (public/icons/) and the Google Play listing graphics (docs/play/).
//
//   npm run build && node scripts/make-assets.mjs
//
// Icons are drawn from the same logo as the favicon. Play graphics are screenshots of the
// demo (original made-up songs, so there's nothing copyrighted in them).

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const root = new URL("../", import.meta.url).pathname;
const ICONS = `${root}public/icons/`;
const PLAY = `${root}docs/play/`;
mkdirSync(ICONS, { recursive: true });
mkdirSync(PLAY, { recursive: true });

const BG = "#0b0a1a";

/**
 * The logo (a 32×32 design: gradient disc with two "lyric lines"), drawn at `size` px with the
 * disc's radius at `radiusFrac` of the image, on a transparent or dark background.
 */
function logoSvg(size, radiusFrac, background) {
  const s = (size * radiusFrac) / 14; // the disc has radius 14 in the 32-unit design
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff2e88"/><stop offset="1" stop-color="#00d4ff"/></linearGradient></defs>
  ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}
  <g transform="translate(${size / 2} ${size / 2}) scale(${s}) translate(-16 -16)">
    <circle cx="16" cy="16" r="14" fill="url(#g)"/>
    <path d="M9 19h14M11 14h10" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  </g>
</svg>`;
}

async function renderSvg(page, svg, size, path) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path, omitBackground: true, type: "png" });
  console.log("wrote", path.replace(root, ""));
}

const browser = await chromium.launch();
try {
  // ---- App icons ----
  {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    // "any": the disc alone, nearly filling the square (like the favicon).
    await renderSvg(page, logoSvg(192, 0.47, null), 192, `${ICONS}icon-192.png`);
    await renderSvg(page, logoSvg(512, 0.47, null), 512, `${ICONS}icon-512.png`);
    // "maskable": Android crops icons to circles, squircles, etc. Keep the disc inside the
    // middle 80% safe zone and fill the rest with the app's background color.
    await renderSvg(page, logoSvg(512, 0.33, BG), 512, `${ICONS}maskable-512.png`);
    // Play Store icon: full square (Play rounds the corners itself).
    await renderSvg(page, logoSvg(512, 0.38, BG), 512, `${PLAY}icon-512.png`);
    await page.close();
  }

  // ---- Play listing graphics, from the demo ----
  const PORT = 4174;
  const BASE = `http://127.0.0.1:${PORT}/`;
  const viteBin = `${root}node_modules/vite/bin/vite.js`;
  const server = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on("data", (d) => String(d).includes(String(PORT)) && resolve());
      server.on("exit", (c) => reject(new Error(`preview exited ${c}`)));
      setTimeout(() => reject(new Error("preview didn't start")), 15000);
    });

    // bypassCSP only so this script can hide the on-screen controls with a style tag.
    const hideHud = "#hud,#hint,#toast,#progress,#upnext{display:none!important}*{cursor:none!important}";
    const open = async (viewport, scale, settings) => {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, bypassCSP: true, serviceWorkers: "block" });
      await ctx.addInitScript((s) => localStorage.setItem("sv.settings", JSON.stringify(s)), settings);
      const page = await ctx.newPage();
      await page.goto(`${BASE}?demo`);
      await page.waitForFunction(() => document.getElementById("np-title")?.textContent === "Neon Weather");
      return { ctx, page };
    };
    const shot = async (page, name) => {
      await page.screenshot({ path: `${PLAY}${name}`, type: "jpeg", quality: 90 });
      console.log("wrote", `docs/play/${name}`);
    };

    // Feature graphic 1024×500: the visualizer mid-lyric, no controls.
    {
      const { ctx, page } = await open({ width: 1024, height: 500 }, 1, { style: "glow" });
      await page.addStyleTag({ content: hideHud });
      await page.waitForTimeout(5600);
      await shot(page, "feature-graphic.jpg");
      await ctx.close();
    }

    // Phone screenshots, 1080×1920 (360×640 at 3×).
    const phone = { width: 360, height: 640 };
    {
      // 1: Glow with the now-playing card showing.
      const { ctx, page } = await open(phone, 3, { style: "glow" });
      await page.waitForTimeout(5200);
      await page.mouse.move(180, 300);
      await page.waitForTimeout(400);
      await shot(page, "phone-1-glow.jpg");
      await ctx.close();
    }
    {
      // 2: Aurora, lyrics only.
      const { ctx, page } = await open(phone, 3, { style: "aurora" });
      await page.addStyleTag({ content: hideHud });
      await page.waitForTimeout(9200);
      await shot(page, "phone-2-aurora.jpg");
      await ctx.close();
    }
    {
      // 3: Karaoke mode.
      const { ctx, page } = await open(phone, 3, { style: "tunnel", karaoke: true });
      await page.addStyleTag({ content: hideHud });
      await page.waitForTimeout(7400);
      await shot(page, "phone-3-karaoke.jpg");
      await ctx.close();
    }
    {
      // 4: Settings.
      const { ctx, page } = await open(phone, 3, { style: "vinyl" });
      await page.waitForTimeout(3000);
      await page.keyboard.press("s");
      await page.waitForTimeout(500);
      await shot(page, "phone-4-settings.jpg");
      await ctx.close();
    }
  } finally {
    server.kill();
  }
} finally {
  await browser.close();
}
