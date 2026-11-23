import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Content-Security-Policy for the production build only (the dev server needs
// inline scripts and a websocket for hot reload). The page may only talk to
// Spotify and LRCLIB, and only load images from Spotify's image CDNs.
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
  "worker-src 'none'",
  "manifest-src 'none'",
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

export default defineConfig({
  // GitHub Pages serves the app from /<repo-name>/; the deploy workflow sets this.
  base: process.env.BASE_PATH ?? "/",
  plugins: [cspPlugin()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
