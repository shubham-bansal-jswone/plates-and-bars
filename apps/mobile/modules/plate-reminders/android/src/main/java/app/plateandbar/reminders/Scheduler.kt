package app.plateandbar.reminders

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import java.util.TimeZone

/**
 * Keeps the rules in the app's private preferences (so a reboot can re-arm them without starting the app) and sets one
 * inexact alarm per rule. Each alarm fires once; [ReminderReceiver] posts the notification and arms the next one.
 * No Google Play services, no Firebase, no exact-alarm permission: a reminder can arrive a few minutes late.
 */
object Scheduler {
  const val CHANNEL_ID = "reminders"
  const val EXTRA_ID = "id"
  const val EXTRA_AT = "at"
  /** A fire this far past its time (device off or dozing for hours) is skipped rather than shown stale. */
  const val STALE_MS = 3 * 60 * 60 * 1000L
  private const val PREFS = "plate_reminders"
  private const val KEY = "rules"

  fun load(context: Context): List<Rule> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
    return try {
      val a = JSONArray(raw)
      List(a.length()) { Rule.fromJson(a.getJSONObject(it)) }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun save(context: Context, rules: List<Rule>) {
    val a = JSONArray()
    rules.forEach { a.put(it.toJson()) }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, a.toString()).apply()
  }

  /** Replaces every rule: the old alarms are cancelled, the new ones kept and armed. Invalid rules are dropped. */
  fun replaceAll(context: Context, rules: List<Rule>) {
    load(context).forEach { cancel(context, it.id) }
    val valid = rules.filter { it.isValid() }
    save(context, valid)
    if (valid.isNotEmpty()) ensureChannel(context) // so "Reminders" shows in the system settings once a reminder is on
    valid.forEach { arm(context, it) }
  }

  fun cancelAll(context: Context) = replaceAll(context, emptyList())

  /** Arms every kept rule again (after boot, an update, or a clock or time zone change). */
  fun rearmAll(context: Context) {
    load(context).forEach { arm(context, it) }
  }

  fun arm(context: Context, rule: Rule, nowMillis: Long = System.currentTimeMillis()) {
    val at = nextFire(rule, nowMillis, TimeZone.getDefault()) ?: return
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    // Inexact and allowed in Doze: needs no special permission.
    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, firePending(context, rule.id, at))
  }

  private fun cancel(context: Context, id: String) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarms.cancel(firePending(context, id, 0L))
  }

  private fun firePending(context: Context, id: String, at: Long): PendingIntent {
    val intent = Intent(context, ReminderReceiver::class.java).putExtra(EXTRA_ID, id).putExtra(EXTRA_AT, at)
    return PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_DEFAULT))
  }

  fun tapIntent(context: Context, rule: Rule): PendingIntent {
    // The app's own scheme, opened by the app itself (setPackage): Expo Router maps it to the tab, also from a cold start.
    val view = Intent(Intent.ACTION_VIEW, Uri.parse(rule.route)).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(context, rule.id.hashCode(), view, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
