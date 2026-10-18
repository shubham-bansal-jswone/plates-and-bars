package app.plateandbar.reminders

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

/**
 * One repeating reminder: [hour]:[minute] local time on each of [days] (0 = Sunday ... 6 = Saturday, as in packages/core).
 * [route] is the deep link opened by a tap and must be a plateandbar:// URL. What to schedule is decided by the app
 * (packages/core and src/reminders); this side only keeps the rules and fires them.
 */
data class Rule(
  val id: String,
  val hour: Int,
  val minute: Int,
  val days: List<Int>,
  val title: String,
  val body: String,
  val route: String,
) {
  fun isValid(): Boolean =
    id.isNotEmpty() && hour in 0..23 && minute in 0..59 && days.isNotEmpty() && days.all { it in 0..6 } &&
      route.startsWith(ROUTE_PREFIX)

  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("hour", hour).put("minute", minute)
    .put("days", JSONArray(days)).put("title", title).put("body", body).put("route", route)

  companion object {
    const val ROUTE_PREFIX = "plateandbar://"

    fun fromJson(o: JSONObject): Rule {
      val d = o.getJSONArray("days")
      return Rule(
        o.getString("id"), o.getInt("hour"), o.getInt("minute"), List(d.length()) { d.getInt(it) },
        o.getString("title"), o.getString("body"), o.getString("route"),
      )
    }
  }
}

/** Pure: the next time a rule fires strictly after [nowMillis] in [zone], in epoch milliseconds, or null for a rule with no days. */
fun nextFire(rule: Rule, nowMillis: Long, zone: TimeZone): Long? {
  if (rule.days.isEmpty()) return null
  val cal = Calendar.getInstance(zone)
  cal.timeInMillis = nowMillis
  for (i in 0..7) {
    val c = cal.clone() as Calendar
    c.add(Calendar.DAY_OF_YEAR, i)
    c.set(Calendar.HOUR_OF_DAY, rule.hour)
    c.set(Calendar.MINUTE, rule.minute)
    c.set(Calendar.SECOND, 0)
    c.set(Calendar.MILLISECOND, 0)
    val weekday = c.get(Calendar.DAY_OF_WEEK) - 1
    if (c.timeInMillis > nowMillis && weekday in rule.days) return c.timeInMillis
  }
  return null
}
