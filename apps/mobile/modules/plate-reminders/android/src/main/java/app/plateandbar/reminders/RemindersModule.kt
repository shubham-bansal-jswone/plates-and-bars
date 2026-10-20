package app.plateandbar.reminders

import android.Manifest
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class RuleRecord : Record {
  @Field var id: String = ""
  @Field var hour: Int = 0
  @Field var minute: Int = 0
  @Field var days: List<Int> = emptyList()
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var route: String = ""

  fun toRule() = Rule(id, hour, minute, days, title, body, route)
}

class RestRecord : Record {
  // JS numbers arrive as Double: ids and ends are epoch milliseconds, exact in a Double.
  @Field var id: Double = 0.0
  @Field var end: Double = 0.0
  @Field var extendMs: Double = 0.0
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var doneTitle: String = ""
  @Field var doneBody: String = ""
  @Field var extendLabel: String = ""
  @Field var skipLabel: String = ""

  fun toState() = RestState(id.toLong(), end.toLong(), extendMs.toLong(), title, body, doneTitle, doneBody, extendLabel, skipLabel)
}

class RemindersModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** "granted" when the app may post notifications now, otherwise "denied". */
  private fun status(): String {
    val ok = context.getSystemService(NotificationManager::class.java).areNotificationsEnabled() &&
      (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    return if (ok) "granted" else "denied"
  }

  override fun definition() = ModuleDefinition {
    Name("PlateReminders")

    AsyncFunction("getPermissionStatus") { -> status() }

    // Android 13+ asks the user; below that there is no prompt and the answer is the system's notification switch.
    AsyncFunction("requestPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@AsyncFunction promise.resolve(status())
      val manager = appContext.permissions ?: throw Exceptions.PermissionsModuleNotFound()
      manager.askForPermissions(
        PermissionsResponseListener { result ->
          val granted = result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED
          promise.resolve(if (granted && status() == "granted") "granted" else "denied")
        },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }

    // Replaces every rule (an empty list switches all reminders off).
    AsyncFunction("setRules") { rules: List<RuleRecord> ->
      Scheduler.replaceAll(context, rules.map { it.toRule() })
    }

    AsyncFunction("cancelAll") { ->
      Scheduler.cancelAll(context)
      RestNotifier.take(context)
    }

    // Rest-timer notification (#1068). `showRest` when the app goes to the background with a rest running.
    AsyncFunction("showRest") { rest: RestRecord -> RestNotifier.start(context, rest.toState()) }

    // When the app is in the foreground again or the session ended: removes the notification and returns what its actions did
    // ({ id, end, skipped }), or null when there was nothing.
    AsyncFunction("takeRest") { ->
      RestNotifier.take(context)?.let { mapOf("id" to it.id.toDouble(), "end" to it.end.toDouble(), "skipped" to it.skipped) }
    }
  }
}
