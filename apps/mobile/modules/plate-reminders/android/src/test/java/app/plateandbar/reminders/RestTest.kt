package app.plateandbar.reminders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RestTest {
  private fun state(end: Long, active: Boolean = true) =
    RestState(1L, end, 30_000L, "Rest", "b", "Rest done, go!", "d", "+30 s", "Skip rest", active)

  @Test fun extendAddsOneStepToARunningRest() {
    assertEquals(130_000L, extendedEnd(100_000L, 30_000L, 50_000L))
  }

  @Test fun extendAfterTheEndStartsFromNow() {
    assertEquals(230_000L, extendedEnd(100_000L, 30_000L, 200_000L))
  }

  @Test fun alertsForTheLiveEnd() {
    assertEquals(AlertAction.SHOW, alertAction(state(100_000L), 100_000L, 101_000L))
  }

  @Test fun noAlertForAnEndThatWasMoved() {
    assertEquals(AlertAction.IGNORE, alertAction(state(130_000L), 100_000L, 101_000L))
  }

  @Test fun noAlertAfterSkipOrCancel() {
    assertEquals(AlertAction.IGNORE, alertAction(state(100_000L, active = false), 100_000L, 101_000L))
    assertEquals(AlertAction.IGNORE, alertAction(null, 100_000L, 101_000L))
  }

  @Test fun lateAllowanceIsTwoMinutesAtLeast() {
    assertEquals(REST_ALERT_STALE_MS, alertLateAllowance(100_000L, 100_000L - 90_000L))
  }

  @Test fun lateButValidAlarmStillAlerts() {
    // Armed 180 s ahead (a 150 s rest plus one +30 s), delivered 135 s late: inside the allowance of 180 s.
    val s = state(1_000_000L).copy(armedAt = 1_000_000L - 180_000L)
    assertEquals(AlertAction.SHOW, alertAction(s, 1_000_000L, 1_000_000L + 135_000L))
  }

  @Test fun tooLateAlarmIsDroppedAndTheCountdownGoes() {
    val s = state(1_000_000L).copy(armedAt = 1_000_000L - 90_000L)
    assertEquals(AlertAction.DROP, alertAction(s, 1_000_000L, 1_000_000L + REST_ALERT_STALE_MS + 1))
    assertEquals(AlertAction.SHOW, alertAction(s, 1_000_000L, 1_000_000L + REST_ALERT_STALE_MS))
  }
}
