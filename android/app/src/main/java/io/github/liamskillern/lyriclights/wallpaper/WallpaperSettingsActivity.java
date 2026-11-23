package io.github.liamskillern.lyriclights.wallpaper;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;

/**
 * Setup and settings for the live wallpaper: turn on access to the media controls, pick a style
 * and quality, then set it as the wallpaper. Opened from its launcher icon or from the gear in the
 * wallpaper picker. Built in code to keep the app free of extra UI libraries.
 */
public class WallpaperSettingsActivity extends Activity {
    private static final int TEXT = 0xFFF3F0FF;
    private static final int MUTED = 0xFFB9B4D6;
    private static final int BG = 0xFF0B0A1A;

    private TextView accessStatus;
    private Button accessButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SharedPreferences prefs = WallpaperPrefs.of(this);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24);
        col.setPadding(pad, dp(48), pad, pad);

        col.addView(text("Lyric Lights wallpaper", 26, TEXT, true));
        col.addView(text("Your music as light, behind your home screen icons. It draws only while the home screen is showing.", 15, MUTED, false));

        // 1. Access to the media controls
        col.addView(heading("1. See what's playing"));
        col.addView(text("Lyric Lights reads the song from your media controls (the player on your lock screen). It works with Spotify and most music apps, and needs no Spotify login. Android lists this as \"notification access\". Lyric Lights never reads your notifications.", 14, MUTED, false));
        accessStatus = text("", 14, TEXT, true);
        col.addView(accessStatus);
        accessButton = button("Allow access", v -> openAccessSettings());
        col.addView(accessButton);
        col.addView(text("Installed the APK yourself and the switch is greyed out? Android 13+ blocks this for sideloaded apps until you allow it: App info → ⋮ (top right) → Allow restricted settings, then try again.", 13, MUTED, false));
        col.addView(button("Open app info", v -> openAppInfo()));

        // 2. Look
        col.addView(heading("2. Choose the look"));
        col.addView(label("Style"));
        col.addView(spinner(WallpaperPrefs.STYLE_LABELS, WallpaperPrefs.indexOf(WallpaperPrefs.STYLES, prefs.getString(WallpaperPrefs.STYLE, "glow"), 0),
                i -> prefs.edit().putString(WallpaperPrefs.STYLE, WallpaperPrefs.STYLES[i]).apply()));
        col.addView(toggle("Show lyrics", prefs.getBoolean(WallpaperPrefs.LYRICS, true),
                on -> prefs.edit().putBoolean(WallpaperPrefs.LYRICS, on).apply()));
        col.addView(toggle("Karaoke layout", prefs.getBoolean(WallpaperPrefs.KARAOKE, false),
                on -> prefs.edit().putBoolean(WallpaperPrefs.KARAOKE, on).apply()));
        col.addView(label("Quality and battery"));
        col.addView(spinner(WallpaperPrefs.QUALITY_LABELS, WallpaperPrefs.indexOf(WallpaperPrefs.QUALITIES, prefs.getString(WallpaperPrefs.QUALITY, "balanced"), 1),
                i -> prefs.edit().putString(WallpaperPrefs.QUALITY, WallpaperPrefs.QUALITIES[i]).apply()));

        // 3. Set it
        col.addView(heading("3. Set it as your wallpaper"));
        col.addView(button("Set wallpaper", v -> setWallpaper()));
        col.addView(text("Lyrics come from LRCLIB, the same as the app. Song details stay on your phone except the title, artist, album and length, which are sent to LRCLIB to find the lyrics.", 13, MUTED, false));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.addView(col);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean ok = NowPlaying.hasAccess(this);
        accessStatus.setText(ok ? "✓ Access is on" : "Access is off: the wallpaper shows a clock until it's on.");
        accessButton.setText(ok ? "Change access" : "Allow access");
        // Pick up a newly granted permission without restarting the wallpaper.
        if (ok) NowPlaying.get(this).refresh();
    }

    private void openAccessSettings() {
        ComponentName listener = new ComponentName(this, MediaListenerService.class);
        Intent i;
        if (Build.VERSION.SDK_INT >= 30) {
            // Straight to Lyric Lights' own switch.
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                    .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, listener.flattenToString());
        } else {
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        }
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        }
    }

    private void openAppInfo() {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null)));
    }

    private void setWallpaper() {
        Intent i = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
                .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, new ComponentName(this, LyricLightsWallpaperService.class));
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            startActivity(new Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER));
        }
    }

    // ---------- tiny view helpers ----------

    private interface OnPick { void pick(int index); }
    private interface OnToggle { void toggle(boolean on); }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(6), 0, dp(6));
        return t;
    }

    private TextView heading(String s) {
        TextView t = text(s, 18, TEXT, true);
        t.setPadding(0, dp(28), 0, dp(4));
        return t;
    }

    private TextView label(String s) {
        TextView t = text(s, 14, MUTED, false);
        t.setPadding(0, dp(12), 0, 0);
        return t;
    }

    private Button button(String s, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(4);
        b.setLayoutParams(lp);
        return b;
    }

    private Spinner spinner(String[] labels, int selected, OnPick onPick) {
        Spinner sp = new Spinner(this);
        ArrayAdapter<String> a = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        sp.setAdapter(a);
        sp.setSelection(selected, false);
        sp.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                onPick.pick(position);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {}
        });
        return sp;
    }

    private Switch toggle(String s, boolean on, OnToggle onToggle) {
        Switch sw = new Switch(this);
        sw.setText(s);
        sw.setTextColor(TEXT);
        sw.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sw.setChecked(on);
        sw.setPadding(0, dp(10), 0, dp(10));
        sw.setOnCheckedChangeListener((b, checked) -> onToggle.toggle(checked));
        return sw;
    }
}
