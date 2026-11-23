package io.github.liamskillern.lyriclights.wallpaper;

import android.service.notification.NotificationListenerService;

/**
 * Exists only so Android lets the wallpaper read the media controls (title, artist, album art,
 * position). MediaSessionManager.getActiveSessions() requires the caller to own an enabled
 * notification listener.
 *
 * <p>It deliberately does nothing with notifications: onNotificationPosted is not overridden, so
 * no notification content is ever read, stored or sent anywhere.
 */
public class MediaListenerService extends NotificationListenerService {}
