package io.github.liamskillern.lyriclights.wallpaper;

import android.annotation.SuppressLint;
import android.app.Presentation;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.service.wallpaper.WallpaperService;
import android.view.Display;
import android.view.SurfaceHolder;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLConnection;

/**
 * Lyric Lights as a live wallpaper.
 *
 * <p>A wallpaper only gets a Surface, not a window to put Views in, so the visualizer runs in a
 * WebView shown on a private VirtualDisplay that draws straight into the wallpaper's Surface. The
 * WebView loads the copy of the website bundled in the APK (assets/web, built from this repo), not
 * the live site: nothing runs that didn't ship with the app, and it works offline except for
 * lyrics.
 *
 * <p>Battery: Android only shows the wallpaper while the home screen is visible. When it isn't
 * (an app is open, the screen is off) the WebView is hidden and paused, so it draws nothing. While
 * visible, the page caps itself at 20, 30 or 60 fps (the Quality setting) and 5 fps on the clock
 * screen.
 */
public class LyricLightsWallpaperService extends WallpaperService {

    /** Bundled site, served from a fake https origin so it gets a normal secure context. */
    static final String ORIGIN = "https://" + WebViewAssetLoader.DEFAULT_DOMAIN;
    static final String START_URL = ORIGIN + "/lyric-lights/index.html?android-wallpaper";
    private static final int BACKGROUND = 0xFF0B0A1A;

    @Override
    public Engine onCreateEngine() {
        return new LightsEngine();
    }

    private class LightsEngine extends Engine implements NowPlaying.Listener, SharedPreferences.OnSharedPreferenceChangeListener {
        private final Handler main = new Handler(Looper.getMainLooper());
        private VirtualDisplay display;
        private Presentation presentation;
        private WebView web;
        private boolean pageReady;
        private boolean visible;
        private int width, height;

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setTouchEventsEnabled(false);
            WallpaperPrefs.of(LyricLightsWallpaperService.this).registerOnSharedPreferenceChangeListener(this);
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int w, int h) {
            super.onSurfaceChanged(holder, format, w, h);
            if (w <= 0 || h <= 0) return;
            width = w;
            height = h;
            int dpi = getResources().getDisplayMetrics().densityDpi;
            if (display == null) {
                DisplayManager dm = getSystemService(DisplayManager.class);
                // No flags: a private display only this app can show windows on.
                display = dm.createVirtualDisplay("LyricLightsWallpaper", w, h, dpi, holder.getSurface(), 0);
                show(display.getDisplay());
            } else {
                display.setSurface(holder.getSurface());
                display.resize(w, h, dpi);
            }
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            tearDown();
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onVisibilityChanged(boolean isVisible) {
            visible = isVisible;
            if (web == null) return;
            if (isVisible) {
                web.setVisibility(View.VISIBLE);
                web.onResume();
                NowPlaying.get(LyricLightsWallpaperService.this).addListener(this);
                post("{\"type\":\"visible\",\"visible\":true}");
            } else {
                post("{\"type\":\"visible\",\"visible\":false}");
                NowPlaying.get(LyricLightsWallpaperService.this).removeListener(this);
                // Hidden WebViews stop requestAnimationFrame; onPause stops the rest.
                web.setVisibility(View.INVISIBLE);
                web.onPause();
            }
        }

        @Override
        public void onDestroy() {
            WallpaperPrefs.of(LyricLightsWallpaperService.this).unregisterOnSharedPreferenceChangeListener(this);
            tearDown();
            super.onDestroy();
        }

        // ---------- now playing and settings ----------

        @Override
        public void onNowPlaying(String json) {
            if (visible) post(json);
        }

        @Override
        public void onSharedPreferenceChanged(SharedPreferences prefs, String key) {
            post(WallpaperPrefs.toMessage(LyricLightsWallpaperService.this));
        }

        /** Send one JSON message to the page. Only our own bundled origin can receive it. */
        private void post(String json) {
            if (web == null || !pageReady || json == null) return;
            web.postWebMessage(new WebMessage(json), Uri.parse(ORIGIN));
        }

        private void onPageReady() {
            pageReady = true;
            post(WallpaperPrefs.toMessage(LyricLightsWallpaperService.this));
            post("{\"type\":\"visible\",\"visible\":" + visible + "}");
            NowPlaying np = NowPlaying.get(LyricLightsWallpaperService.this);
            if (visible) {
                np.addListener(this); // sends the current song right away
            }
        }

        // ---------- the WebView ----------

        @SuppressLint("SetJavaScriptEnabled")
        private void show(Display target) {
            presentation = new Presentation(LyricLightsWallpaperService.this, target);
            Context ctx = presentation.getContext();
            web = new WebView(ctx);
            web.setBackgroundColor(BACKGROUND);

            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            // Lock everything else down: no local files, no content providers, no popups,
            // no location, no autoplaying media.
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(false);
            s.setGeolocationEnabled(false);
            s.setSupportMultipleWindows(false);
            s.setJavaScriptCanOpenWindowsAutomatically(false);
            s.setMediaPlaybackRequiresUserGesture(true);
            s.setCacheMode(WebSettings.LOAD_DEFAULT);

            final AssetManagerHandler assets = new AssetManagerHandler(ctx);
            final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                    .addPathHandler("/lyric-lights/", assets)
                    .build();

            web.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    // Bundled files come from the APK; LRCLIB goes to the network as usual
                    // (the page's Content-Security-Policy allows nothing else).
                    return loader.shouldInterceptRequest(request.getUrl());
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    // A wallpaper never navigates anywhere.
                    return true;
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    if (url != null && url.startsWith(ORIGIN + "/lyric-lights/")) onPageReady();
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    // The renderer crashed or was killed for memory. Rebuild instead of taking the
                    // whole wallpaper down with it.
                    main.post(LightsEngine.this::rebuild);
                    return true;
                }
            });
            web.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    // No microphone or camera from the wallpaper.
                    request.deny();
                }
            });

            presentation.setContentView(web);
            presentation.show();
            pageReady = false;
            web.loadUrl(START_URL);
            if (!visible) {
                web.setVisibility(View.INVISIBLE);
                web.onPause();
            }
        }

        private void rebuild() {
            if (display == null) return;
            destroyWebView();
            show(display.getDisplay());
        }

        private void destroyWebView() {
            NowPlaying.get(LyricLightsWallpaperService.this).removeListener(this);
            pageReady = false;
            if (presentation != null) {
                presentation.dismiss();
                presentation = null;
            }
            if (web != null) {
                web.destroy();
                web = null;
            }
        }

        private void tearDown() {
            destroyWebView();
            if (display != null) {
                display.release();
                display = null;
            }
        }
    }

    /** Serves assets/web/… for https://appassets.androidplatform.net/lyric-lights/… */
    static final class AssetManagerHandler implements WebViewAssetLoader.PathHandler {
        private final Context context;

        AssetManagerHandler(Context context) {
            this.context = context;
        }

        @Override
        public WebResourceResponse handle(String path) {
            if (path.isEmpty()) path = "index.html";
            if (path.contains("..") || path.startsWith("/")) return notFound();
            try {
                InputStream in = context.getAssets().open("web/" + path);
                return new WebResourceResponse(mimeType(path), null, in);
            } catch (IOException e) {
                return notFound();
            }
        }

        private static WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }

        static String mimeType(String path) {
            String p = path.toLowerCase(java.util.Locale.ROOT);
            if (p.endsWith(".html")) return "text/html";
            if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
            if (p.endsWith(".woff2")) return "font/woff2";
            if (p.endsWith(".woff")) return "font/woff";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
            if (p.endsWith(".webp")) return "image/webp";
            String guess = URLConnection.guessContentTypeFromName(p);
            return guess != null ? guess : "application/octet-stream";
        }
    }
}
