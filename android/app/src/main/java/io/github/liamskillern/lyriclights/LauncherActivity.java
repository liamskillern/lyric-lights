/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package io.github.liamskillern.lyriclights;

import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;



public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    

    

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Get the original launch Url.
        Uri uri = super.getLaunchingUrl();

        // Security: this activity is exported, so any app on the phone can start it with a
        // link of its choosing. Only open pages that belong to Lyric Lights. Everything else
        // under liamskillern.github.io is a different project that happens to share the same
        // origin (and the same Digital Asset Link), so it must not open full screen in this app.
        if (!isLyricLightsUrl(uri)) {
            return Uri.parse(getString(R.string.launchUrl));
        }
        return uri;
    }

    /** True only for https://liamskillern.github.io/lyric-lights/... with no tricks in it. */
    static boolean isLyricLightsUrl(Uri uri) {
        if (uri == null) return false;
        if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
        if (!APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
        // user:pass@ and explicit ports are never part of a real Lyric Lights link.
        if (uri.getUserInfo() != null || uri.getPort() != -1) return false;
        String path;
        try {
            // Resolve "." and ".." first, so /lyric-lights/../other/ can't sneak out of the app.
            path = new java.net.URI(uri.toString()).normalize().getPath();
        } catch (java.net.URISyntaxException e) {
            return false;
        }
        return path != null && path.startsWith(APP_PATH) && !path.contains("/../");
    }

    private static final String APP_HOST = "liamskillern.github.io";
    private static final String APP_PATH = "/lyric-lights/";
}
