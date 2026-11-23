import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * `TARGET=wallpaper-engine` builds the Wallpaper Engine package (scripts/make-wallpaper-engine.mjs):
 * one self-contained index.html that runs from a local file, so the wallpaper never navigates to
 * another site. See docs/WINDOWS_WALLPAPER.md.
 */
const isWallpaperEngine = process.env.TARGET === "wallpaper-engine";

// Content-Security-Policy for the production build only (the dev server needs
// inline scripts and a websocket for hot reload). The page may only talk to
// Spotify and LRCLIB, and only load images from Spotify's image CDNs. The app manifest and
// the offline service worker (public/sw.js) may only come from this site.
// `frame-ancestors` (block other sites from framing this page) only works as a real
// HTTP header, which GitHub Pages can't send; src/frame.ts covers that instead.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https://*.scdn.co https://*.spotifycdn.com",
  "connect-src https://api.spotify.com https://accounts.spotify.com https://lrclib.net",
  "media-src 'none'",
  "frame-src 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "inject-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

/**
 * Wallpaper Engine build: put the script, the stylesheet and the fonts inside index.html, and lock
 * it down with a Content-Security-Policy that allows exactly that script and stylesheet (by hash)
 * and the same network destinations as the website.
 */
function singleFilePlugin(): Plugin {
  return {
    name: "single-file",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName === "index.html");
      if (!html || html.type !== "asset") throw new Error("single-file: no index.html");
      let page = String(html.source);
      let js = "";
      let css = "";
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk") js += file.code;
        else if (name.endsWith(".css")) css += String(file.source);
        else continue;
        delete bundle[name];
      }
      // Drop the tags that pointed at the separate files, the web app manifest and module hints.
      page = page
        .replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*><\/script>\s*/g, "")
        .replace(/<link\b[^>]*rel="(?:stylesheet|manifest|modulepreload)"[^>]*>\s*/g, "");
      // Script text can't contain "</script" (it would end the tag early).
      js = js.replace(/<\/(script)/gi, "<\\/$1");
      const policy = [
        "default-src 'none'",
        `script-src ${sha256(js)}`,
        `style-src ${sha256(css)}`,
        "font-src data:",
        "img-src data: blob: https://*.scdn.co https://*.spotifycdn.com",
        "connect-src https://api.spotify.com https://accounts.spotify.com https://lrclib.net",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ");
      page = page
        .replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
        .replace("</head>", `    <style>${css}</style>\n  </head>`)
        .replace("</body>", `    <script>${js}</script>\n  </body>`);
      html.source = page;
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the app from /<repo-name>/; the deploy workflow sets this.
  base: isWallpaperEngine ? "./" : (process.env.BASE_PATH ?? "/"),
  plugins: isWallpaperEngine ? [singleFilePlugin()] : [cspPlugin()],
  publicDir: isWallpaperEngine ? false : "public",
  define: isWallpaperEngine
    ? {
        "import.meta.env.VITE_TARGET": JSON.stringify("wallpaper-engine"),
        // The Client ID comes with the pairing code instead (see auth.ts parsePairCode).
        "import.meta.env.VITE_SPOTIFY_CLIENT_ID": JSON.stringify(""),
      }
    : {},
  build: isWallpaperEngine
    ? {
        outDir: "dist-wallpaper-engine",
        // Everything (fonts included) goes inline: a local file can't load others reliably.
        assetsInlineLimit: () => true,
        cssCodeSplit: false,
        modulePreload: false,
        rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
      }
    : {},
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
