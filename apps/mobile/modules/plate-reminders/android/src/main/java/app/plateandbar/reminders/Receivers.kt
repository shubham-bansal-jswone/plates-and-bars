package app.plateandbar.reminders

import android.app.Notification
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** An alarm fired: show the reminder (unless it is stale or notifications are off) and arm the next one. */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val rule = Scheduler.load(context).firstOrNull { it.id == intent.getStringExtra(Scheduler.EXTRA_ID) } ?: return
    val now = System.currentTimeMillis()
    val at = intent.getLongExtra(Scheduler.EXTRA_AT, now)
    val nm = context.getSystemService(NotificationManager::class.java)
    if (now - at <= Scheduler.STALE_MS && nm.areNotificationsEnabled()) {
      Scheduler.ensureChannel(context)
      val n = Notification.Builder(context, Scheduler.CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_reminder)
        .setContentTitle(rule.title)
        .setContentText(rule.body)
        .setContentIntent(Scheduler.tapIntent(context, rule))
        .setAutoCancel(true)
        .build()
      nm.notify(rule.id.hashCode(), n)
    }
    Scheduler.arm(context, rule, maxOf(now, at))
  }
}

/** Boot, app update, clock change, time zone change: the alarms were lost or are now at the wrong local time, so arm them again. */
class RearmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Scheduler.rearmAll(context)
  }
}
