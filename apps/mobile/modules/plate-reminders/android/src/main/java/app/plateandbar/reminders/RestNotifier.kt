package app.plateandbar.reminders

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * The rest-timer notification (#1068): a silent ongoing countdown to the rest's end while the app is in the background, an
 * alert when it ends, and +30 s / Skip actions. Android mirrors it to a paired watch. No new permission and no exact alarm:
 * the alert is an inexact alarm like the reminders, so it can be a little late.
 */
object RestNotifier {
  // One lock for the kept copy: receivers run on the main thread and module functions on the module's queue, and a +30 s must not
  // save and re-arm after `take` cleared it. Every public function below is @Synchronized on this object.
  private const val PREFS = "plate_rest"
  private const val KEY = "rest"
  private const val NOTE_ID = 0x7e57
  private const val CHANNEL_LIVE = "rest_timer"
  private const val CHANNEL_DONE = "rest_done"
  const val ACTION_EXTEND = "app.plateandbar.reminders.REST_EXTEND"
  const val ACTION_SKIP = "app.plateandbar.reminders.REST_SKIP"
  const val EXTRA_END = "end"
  private const val ROUTE = "plateandbar://workout"

  fun load(context: Context): RestState? {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
    return try {
      RestState.fromJson(org.json.JSONObject(raw))
    } catch (e: Exception) {
      null
    }
  }

  private fun save(context: Context, state: RestState?) {
    val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    if (state == null) e.remove(KEY) else e.putString(KEY, state.toJson().toString())
    e.apply()
  }

  private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)
  private fun enabled(context: Context) = manager(context).areNotificationsEnabled()

  /** The app went to the background with a rest running. Does nothing when notifications are off. */
  @Synchronized fun start(context: Context, state: RestState, nowMillis: Long = System.currentTimeMillis()) {
    cancelAlarm(context)
    if (!enabled(context) || state.end <= nowMillis) {
      save(context, null)
      manager(context).cancel(NOTE_ID)
      return
    }
    val armed = state.copy(armedAt = nowMillis)
    save(context, armed)
    postLive(context, armed, nowMillis)
    armAlert(context, armed.end)
  }

  /** "+30 s" from the notification. Extends while [canExtend]; otherwise (skipped, cancelled, or long over) it only takes the alert down. */
  @Synchronized fun extend(context: Context, nowMillis: Long = System.currentTimeMillis()) {
    val s = load(context)
    if (s == null || !canExtend(s, nowMillis)) return stop(context, s, skipped = false)
    val next = s.copy(end = extendedEnd(s.end, s.extendMs, nowMillis), armedAt = nowMillis)
    save(context, next)
    cancelAlarm(context)
    if (enabled(context)) postLive(context, next, nowMillis)
    armAlert(context, next.end)
  }

  /** "Skip rest" from the notification. */
  @Synchronized fun skip(context: Context) = stop(context, load(context), skipped = true)

  private fun stop(context: Context, s: RestState?, skipped: Boolean) {
    cancelAlarm(context)
    manager(context).cancel(NOTE_ID)
    if (s != null) save(context, s.copy(active = false, skipped = skipped))
  }

  /** The app is in the foreground (or the session ended): remove the notification and read what the actions did. Clears the copy. */
  @Synchronized fun take(context: Context): RestState? {
    val s = load(context)
    cancelAlarm(context)
    manager(context).cancel(NOTE_ID)
    save(context, null)
    return s
  }

  /** The alarm for [firedEnd] went off. */
  @Synchronized fun alert(context: Context, firedEnd: Long, nowMillis: Long = System.currentTimeMillis()) {
    val s = load(context)
    val plan = alertPlan(alertAction(s, firedEnd, nowMillis))
    // Too late to be useful: the countdown comes down too, and the copy is no longer live.
    if (plan.cancelCountdown) manager(context).cancel(NOTE_ID)
    if (plan.deactivate && s != null) save(context, s.copy(active = false))
    if (!plan.post || s == null || !enabled(context)) return
    ensureChannels(context)
    val n = builder(context, CHANNEL_DONE)
      .setSmallIcon(R.drawable.ic_reminder)
      .setContentTitle(s.doneTitle)
      .setContentText(s.doneBody)
      .setContentIntent(tap(context))
      .setAutoCancel(true)
      .addAction(action(context, ACTION_EXTEND, s.extendLabel))
      .addAction(action(context, ACTION_SKIP, s.skipLabel))
      .build()
    // Replaces the countdown. Swiping the countdown away (possible on Android 14) leaves the kept copy active, so this still fires:
    // dismissing the countdown is not skipping the rest, and there is deliberately no delete intent. Ongoing notifications are not
    // bridged to a watch; this alert (not ongoing, with +30 s and Skip rest) is what the watch shows.
    manager(context).notify(NOTE_ID, n)
  }

  private fun postLive(context: Context, s: RestState, nowMillis: Long) {
    ensureChannels(context)
    val n = builder(context, CHANNEL_LIVE)
      .setSmallIcon(R.drawable.ic_reminder)
      .setContentTitle(s.title)
      .setContentText(s.body)
      .setContentIntent(tap(context))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(true)
      .setWhen(s.end)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .also {
        // Backstop: the countdown goes away by itself once the alert could no longer be shown, so it never runs far below zero.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          it.setTimeoutAfter(s.end - nowMillis + alertLateAllowance(s.end, s.armedAt))
        }
      }
      .addAction(action(context, ACTION_EXTEND, s.extendLabel))
      .addAction(action(context, ACTION_SKIP, s.skipLabel))
      .build()
    manager(context).notify(NOTE_ID, n)
  }

  private fun builder(context: Context, channel: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, channel)
    } else {
      // minSdk is 24: the channel constructor needs 26.
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }

  @Suppress("DEPRECATION") // Action.Builder(int, CharSequence, PendingIntent) is the form that works from API 24
  private fun action(context: Context, name: String, label: String): Notification.Action =
    Notification.Action.Builder(R.drawable.ic_reminder, label, actionIntent(context, name)).build()

  private fun actionIntent(context: Context, name: String): PendingIntent {
    val i = Intent(context, RestActionReceiver::class.java).setAction(name)
    return PendingIntent.getBroadcast(context, name.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun tap(context: Context): PendingIntent {
    // The app's own scheme, opened by the app itself: Expo Router maps it to the Workout tab, also from a cold start.
    val view = Intent(Intent.ACTION_VIEW, Uri.parse(ROUTE)).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(context, NOTE_ID, view, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun alertPending(context: Context, end: Long): PendingIntent {
    val i = Intent(context, RestAlertReceiver::class.java).putExtra(EXTRA_END, end)
    return PendingIntent.getBroadcast(context, NOTE_ID, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun armAlert(context: Context, end: Long) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, end, alertPending(context, end))
  }

  private fun cancelAlarm(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarms.cancel(alertPending(context, 0L))
  }

  private fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = manager(context)
    // Silent while counting; the alert follows the user's own sound and vibration settings for the channel.
    nm.createNotificationChannel(NotificationChannel(CHANNEL_LIVE, "Rest timer", NotificationManager.IMPORTANCE_LOW))
    nm.createNotificationChannel(NotificationChannel(CHANNEL_DONE, "Rest done", NotificationManager.IMPORTANCE_HIGH))
  }
}

/** The alarm for a rest's end. A stale or moved end shows nothing (see [alertAction]). */
class RestAlertReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    RestNotifier.alert(context, intent.getLongExtra(RestNotifier.EXTRA_END, -1L))
  }
}

/** A tap on +30 s or Skip rest in the notification. */
class RestActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      RestNotifier.ACTION_EXTEND -> RestNotifier.extend(context)
      RestNotifier.ACTION_SKIP -> RestNotifier.skip(context)
    }
  }
}
