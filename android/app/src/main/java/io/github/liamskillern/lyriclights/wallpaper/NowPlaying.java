package io.github.liamskillern.lyriclights.wallpaper;

import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Follows what's playing on the phone through its media sessions (Spotify, YouTube Music, any
 * player that shows media controls). Push-based: Android calls back on every change, so nothing
 * polls. Main thread only.
 */
final class NowPlaying {

    interface Listener {
        /** A "playback" message for the page (see src/wallpaper.ts). */
        void onNowPlaying(String json);
    }

    /** Album art is sent as a small JPEG. 320 px is plenty for colors and the Vinyl style. */
    private static final int ART_PX = 320;

    private static NowPlaying instance;

    static NowPlaying get(Context context) {
        if (instance == null) instance = new NowPlaying(context.getApplicationContext());
        return instance;
    }

    /** Has the user turned on notification access for Lyric Lights? */
    static boolean hasAccess(Context context) {
        return NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.getPackageName());
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Listener> listeners = new ArrayList<>();
    private final List<MediaController> controllers = new ArrayList<>();
    private MediaSessionManager manager;
    private boolean started;

    private String artTrackId;
    private String artData;
    private String lastJson;

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsChanged = this::watch;

    private final MediaController.Callback callback = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            publish();
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            publish();
        }

        @Override
        public void onSessionDestroyed() {
            refresh();
        }
    };

    private NowPlaying(Context context) {
        this.context = context;
    }

    /** Start following a listener; it gets the current song right away. Safe to call again. */
    void addListener(Listener l) {
        if (!listeners.contains(l)) listeners.add(l);
        start();
        l.onNowPlaying(current());
    }

    void removeListener(Listener l) {
        listeners.remove(l);
        if (listeners.isEmpty()) stop();
    }

    /** Re-check sessions, e.g. after the user grants access. */
    void refresh() {
        if (!started) {
            start();
        } else if (manager != null) {
            try {
                watch(manager.getActiveSessions(component()));
            } catch (SecurityException e) {
                watch(null);
            }
        }
        publish();
    }

    /** The latest message, worked out fresh so the position is right now. */
    String current() {
        String json = build(pick());
        lastJson = json;
        return json;
    }

    private ComponentName component() {
        return new ComponentName(context, MediaListenerService.class);
    }

    private void start() {
        if (started) return;
        manager = context.getSystemService(MediaSessionManager.class);
        if (manager == null || !hasAccess(context)) return;
        try {
            manager.addOnActiveSessionsChangedListener(sessionsChanged, component(), main);
            watch(manager.getActiveSessions(component()));
            started = true;
        } catch (SecurityException e) {
            // Access was turned off between the check and the call.
            started = false;
        }
    }

    private void stop() {
        if (manager != null && started) manager.removeOnActiveSessionsChangedListener(sessionsChanged);
        watch(null);
        started = false;
        artTrackId = null;
        artData = null;
        lastJson = null;
    }

    private void watch(List<MediaController> active) {
        for (MediaController c : controllers) c.unregisterCallback(callback);
        controllers.clear();
        if (active != null) {
            for (MediaController c : active) {
                c.registerCallback(callback, main);
                controllers.add(c);
            }
        }
        publish();
    }

    /** The session to show: the first one playing, else the most recent one. */
    private MediaController pick() {
        for (MediaController c : controllers) {
            PlaybackState s = c.getPlaybackState();
            if (s != null && s.getState() == PlaybackState.STATE_PLAYING && c.getMetadata() != null) return c;
        }
        for (MediaController c : controllers) if (c.getMetadata() != null) return c;
        return null;
    }

    private void publish() {
        if (listeners.isEmpty()) return;
        String json = current();
        for (Listener l : new ArrayList<>(listeners)) l.onNowPlaying(json);
    }

    private String build(MediaController c) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", "playback");
            MediaMetadata m = c == null ? null : c.getMetadata();
            String title = m == null ? null : m.getString(MediaMetadata.METADATA_KEY_TITLE);
            if (m == null || title == null || title.isEmpty()) {
                o.put("track", JSONObject.NULL);
                o.put("isPlaying", false);
                o.put("positionMs", 0);
                return o.toString();
            }
            String artist = first(m.getString(MediaMetadata.METADATA_KEY_ARTIST), m.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST));
            String album = first(m.getString(MediaMetadata.METADATA_KEY_ALBUM), "");
            String mediaId = m.getString(MediaMetadata.METADATA_KEY_MEDIA_ID);
            String id = c.getPackageName() + "|" + (mediaId != null && !mediaId.isEmpty() ? mediaId : title + "|" + artist + "|" + album);

            JSONObject track = new JSONObject();
            track.put("id", id);
            track.put("name", title);
            JSONArray artists = new JSONArray();
            if (!artist.isEmpty()) artists.put(artist);
            track.put("artists", artists);
            track.put("album", album);
            track.put("durationMs", Math.max(0, m.getLong(MediaMetadata.METADATA_KEY_DURATION)));
            o.put("track", track);

            PlaybackState s = c.getPlaybackState();
            boolean playing = s != null && s.getState() == PlaybackState.STATE_PLAYING;
            o.put("isPlaying", playing);
            o.put("positionMs", positionNow(s));

            String art = artFor(id, m);
            if (art != null) o.put("art", art);
        } catch (JSONException e) {
            return "{\"type\":\"playback\",\"track\":null}";
        }
        return o.toString();
    }

    private static long positionNow(PlaybackState s) {
        if (s == null) return 0;
        long pos = s.getPosition();
        if (pos < 0) return 0;
        if (s.getState() == PlaybackState.STATE_PLAYING && s.getLastPositionUpdateTime() > 0) {
            long since = SystemClock.elapsedRealtime() - s.getLastPositionUpdateTime();
            pos += (long) (since * s.getPlaybackSpeed());
        }
        return Math.max(0, pos);
    }

    /** Album art as a data: URL, encoded once per track. */
    private String artFor(String id, MediaMetadata m) {
        if (id.equals(artTrackId)) return artData;
        Bitmap b = m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (b == null) b = m.getBitmap(MediaMetadata.METADATA_KEY_ART);
        if (b == null) b = m.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
        // Some players send the track first and the art a moment later: don't cache "no art".
        if (b == null) return null;
        artTrackId = id;
        artData = encode(b);
        return artData;
    }

    private static String encode(Bitmap b) {
        int w = b.getWidth(), h = b.getHeight();
        if (w <= 0 || h <= 0) return null;
        float scale = Math.min(1f, (float) ART_PX / Math.max(w, h));
        Bitmap small = scale < 1f ? Bitmap.createScaledBitmap(b, Math.round(w * scale), Math.round(h * scale), true) : b;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        small.compress(Bitmap.CompressFormat.JPEG, 85, out);
        if (small != b) small.recycle();
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    private static String first(String a, String b) {
        if (a != null && !a.isEmpty()) return a;
        return b == null ? "" : b;
    }
}
