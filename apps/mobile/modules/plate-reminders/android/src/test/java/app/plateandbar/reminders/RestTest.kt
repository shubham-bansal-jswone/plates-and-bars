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
    assertTrue(shouldAlert(state(100_000L), 100_000L, 101_000L))
  }

  @Test fun noAlertForAnEndThatWasMoved() {
    assertFalse(shouldAlert(state(130_000L), 100_000L, 101_000L))
  }

  @Test fun noAlertAfterSkipOrCancel() {
    assertFalse(shouldAlert(state(100_000L, active = false), 100_000L, 101_000L))
    assertFalse(shouldAlert(null, 100_000L, 101_000L))
  }

  @Test fun noStaleAlert() {
    assertTrue(shouldAlert(state(100_000L), 100_000L, 100_000L + REST_ALERT_STALE_MS))
    assertFalse(shouldAlert(state(100_000L), 100_000L, 100_000L + REST_ALERT_STALE_MS + 1))
  }
}
