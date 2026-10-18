package app.plateandbar.reminders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class NextFireTest {
  private val utc = TimeZone.getTimeZone("UTC")
  private val kolkata = TimeZone.getTimeZone("Asia/Kolkata")

  private fun at(zone: TimeZone, y: Int, mo: Int, d: Int, h: Int, mi: Int): Long {
    val c = Calendar.getInstance(zone)
    c.clear()
    c.set(y, mo - 1, d, h, mi, 0)
    return c.timeInMillis
  }

  private fun rule(days: List<Int>, hour: Int = 7, minute: Int = 30) =
    Rule("weigh_in", hour, minute, days, "t", "b", "plateandbar://progress")

  // 2026-10-19 is a Monday (weekday 1).
  @Test fun laterTheSameDay() {
    assertEquals(at(utc, 2026, 10, 19, 7, 30), nextFire(rule(listOf(1)), at(utc, 2026, 10, 19, 6, 0), utc))
  }

  @Test fun passedTodayGoesToTheNextListedDay() {
    assertEquals(at(utc, 2026, 10, 21, 7, 30), nextFire(rule(listOf(1, 3)), at(utc, 2026, 10, 19, 8, 0), utc))
  }

  @Test fun exactlyNowIsNotNext() {
    assertEquals(at(utc, 2026, 10, 26, 7, 30), nextFire(rule(listOf(1)), at(utc, 2026, 10, 19, 7, 30), utc))
  }

  @Test fun followsTheLocalZone() {
    assertEquals(at(kolkata, 2026, 10, 20, 7, 30), nextFire(rule(listOf(0, 1, 2, 3, 4, 5, 6)), at(kolkata, 2026, 10, 19, 12, 0), kolkata))
  }

  @Test fun noDaysNoFire() {
    assertNull(nextFire(rule(emptyList()), 0L, utc))
  }

  @Test fun validity() {
    assertTrue(rule(listOf(0)).isValid())
    assertFalse(rule(listOf(7)).isValid())
    assertFalse(rule(listOf(1), hour = 24).isValid())
    assertFalse(rule(listOf(1)).copy(route = "https://example.com").isValid())
  }
}
