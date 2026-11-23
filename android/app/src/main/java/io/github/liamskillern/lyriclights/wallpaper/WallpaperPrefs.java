package io.github.liamskillern.lyriclights.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

/** The wallpaper's own settings (separate from the app's, which live in Chrome). */
final class WallpaperPrefs {
    static final String FILE = "wallpaper";
    static final String STYLE = "style";
    static final String LYRICS = "showLyrics";
    static final String KARAOKE = "karaoke";
    static final String QUALITY = "quality";

    /** Values must match STYLES in src/settings.ts and QUALITIES in src/wallpaper.ts. */
    static final String[] STYLES = {"glow", "aurora", "vinyl", "tunnel"};
    static final String[] STYLE_LABELS = {"Glow", "Aurora", "Vinyl", "Tunnel"};
    static final String[] QUALITIES = {"saver", "balanced", "sharp"};
    static final String[] QUALITY_LABELS = {
        "Battery saver (20 fps, softer)",
        "Balanced (30 fps)",
        "Sharp (60 fps, most battery)",
    };

    static SharedPreferences of(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** A "settings" message for the page (see src/wallpaper.ts). */
    static String toMessage(Context c) {
        SharedPreferences p = of(c);
        try {
            JSONObject s = new JSONObject();
            s.put("style", p.getString(STYLE, "glow"));
            s.put("showLyrics", p.getBoolean(LYRICS, true));
            s.put("karaoke", p.getBoolean(KARAOKE, false));
            JSONObject o = new JSONObject();
            o.put("type", "settings");
            o.put("settings", s);
            o.put("quality", p.getString(QUALITY, "balanced"));
            return o.toString();
        } catch (JSONException e) {
            return "{\"type\":\"settings\",\"settings\":{}}";
        }
    }

    static int indexOf(String[] options, String value, int fallback) {
        for (int i = 0; i < options.length; i++) if (options[i].equals(value)) return i;
        return fallback;
    }

    private WallpaperPrefs() {}
}
