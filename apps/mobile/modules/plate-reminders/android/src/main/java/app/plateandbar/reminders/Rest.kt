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
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("end", end).put("extendMs", extendMs).put("title", title).put("body", body)
    .put("doneTitle", doneTitle).put("doneBody", doneBody).put("extendLabel", extendLabel).put("skipLabel", skipLabel)
    .put("active", active).put("skipped", skipped)

  companion object {
    fun fromJson(o: JSONObject) = RestState(
      o.getLong("id"), o.getLong("end"), o.getLong("extendMs"), o.getString("title"), o.getString("body"),
      o.getString("doneTitle"), o.getString("doneBody"), o.getString("extendLabel"), o.getString("skipLabel"),
      o.getBoolean("active"), o.getBoolean("skipped"),
    )
  }
}

/** An alert this far past its time (device dozing) is dropped rather than shown stale. */
const val REST_ALERT_STALE_MS = 2 * 60 * 1000L

/** Pure: "+30 s" moves the end that far on from the later of the end and now, so a rest that already ended gets a full extra step. */
fun extendedEnd(end: Long, extendMs: Long, nowMillis: Long): Long = maxOf(end, nowMillis) + extendMs

/**
 * Pure: whether the alarm that fired for [firedEnd] may show the alert. Only when the rest is still live, the alarm is for the
 * end the rest has now (a +30 s or a newer rest moved it), and it is not stale.
 */
fun shouldAlert(state: RestState?, firedEnd: Long, nowMillis: Long): Boolean =
  state != null && state.active && state.end == firedEnd && nowMillis - state.end <= REST_ALERT_STALE_MS
