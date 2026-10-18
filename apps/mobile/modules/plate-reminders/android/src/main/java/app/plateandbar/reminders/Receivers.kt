package app.plateandbar.reminders

import android.app.Notification
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** An alarm fired: show the reminder (unless it is stale or notifications are off) and arm the next one. */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val rule = Scheduler.load(context).firstOrNull { it.id == intent.getStringExtra(Scheduler.EXTRA_ID) } ?: return
    val now = System.currentTimeMillis()
    val at = intent.getLongExtra(Scheduler.EXTRA_AT, now)
    // The next one first: a failure while posting this one must not end the chain.
    Scheduler.arm(context, rule, maxOf(now, at))
    val nm = context.getSystemService(NotificationManager::class.java)
    if (now - at <= Scheduler.STALE_MS && nm.areNotificationsEnabled()) {
      Scheduler.ensureChannel(context)
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, Scheduler.CHANNEL_ID)
      } else {
        // minSdk is 24: the channel constructor needs 26.
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      val n = builder
        .setSmallIcon(R.drawable.ic_reminder)
        .setContentTitle(rule.title)
        .setContentText(rule.body)
        .setContentIntent(Scheduler.tapIntent(context, rule))
        .setAutoCancel(true)
        .build()
      nm.notify(rule.id.hashCode(), n)
    }
  }
}

/** Boot, app update, clock change, time zone change: the alarms were lost or are now at the wrong local time, so arm them again. */
class RearmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in ACTIONS) return
    Scheduler.rearmAll(context)
  }

  private companion object {
    val ACTIONS = setOf(
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
    )
  }
}
