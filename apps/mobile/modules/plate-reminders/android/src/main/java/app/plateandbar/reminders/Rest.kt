package app.plateandbar.reminders

import org.json.JSONObject

/**
 * The rest timer as the notification keeps it (#1068). The phone's workout screen owns the rest; this is a copy of its absolute
 * [end] (epoch ms) that the notification actions may move or stop while the app is in the background. The app reads it back
 * when it returns to the foreground (`takeRest`) and applies it to its own rest state.
 * All text and the extend step come from the app (src/reminders/rest.ts, packages/core); this side only shows and fires them.
 */
data class RestState(
  val id: Long,
  val end: Long,
  val extendMs: Long,
  val title: String,
  val body: String,
  val doneTitle: String,
  val doneBody: String,
  val extendLabel: String,
  val skipLabel: String,
  /** False once it was skipped or cancelled: no alert may fire for it. */
  val active: Boolean = true,
  val skipped: Boolean = false,
  /** When the alarm for [end] was armed (epoch ms), so the gate on a late alarm can follow how far ahead it was set. */
  val armedAt: Long = 0L,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("end", end).put("extendMs", extendMs).put("title", title).put("body", body)
    .put("doneTitle", doneTitle).put("doneBody", doneBody).put("extendLabel", extendLabel).put("skipLabel", skipLabel)
    .put("active", active).put("skipped", skipped).put("armedAt", armedAt)

  companion object {
    fun fromJson(o: JSONObject) = RestState(
      o.getLong("id"), o.getLong("end"), o.getLong("extendMs"), o.getString("title"), o.getString("body"),
      o.getString("doneTitle"), o.getString("doneBody"), o.getString("extendLabel"), o.getString("skipLabel"),
      o.getBoolean("active"), o.getBoolean("skipped"), o.optLong("armedAt", 0L),
    )
  }
}

/** The least lateness an alert is still shown with. */
const val REST_ALERT_STALE_MS = 2 * 60 * 1000L

/**
 * Pure: how late (past the end) the alert may still be shown. An inexact alarm (`setAndAllowWhileIdle`) can be deferred by a
 * share of the time until it was due, so the allowance is the larger of [REST_ALERT_STALE_MS] and how far ahead it was armed:
 * a 180 s rest that arrives 135 s late still alerts, and a long deferral is the only thing dropped.
 */
fun alertLateAllowance(end: Long, armedAt: Long): Long = maxOf(REST_ALERT_STALE_MS, end - armedAt)

/** Pure: "+30 s" moves the end that far on from the later of the end and now, so a rest that already ended gets a full extra step. */
fun extendedEnd(end: Long, extendMs: Long, nowMillis: Long): Long = maxOf(end, nowMillis) + extendMs

/** What an alarm that fired for an end should do. */
enum class AlertAction { SHOW, DROP, IGNORE }

/**
 * Pure: SHOW when the rest is live, the alarm is for the end the rest has now (a +30 s or a newer rest moved it) and it is not
 * too late. DROP when it is live and for this end but too late: nothing is shown and the countdown is taken down too, so it
 * never sits below zero. IGNORE for a skipped, cancelled or moved rest.
 */
fun alertAction(state: RestState?, firedEnd: Long, nowMillis: Long): AlertAction = when {
  state == null || !state.active || state.end != firedEnd -> AlertAction.IGNORE
  nowMillis - state.end <= alertLateAllowance(state.end, state.armedAt) -> AlertAction.SHOW
  else -> AlertAction.DROP
}
