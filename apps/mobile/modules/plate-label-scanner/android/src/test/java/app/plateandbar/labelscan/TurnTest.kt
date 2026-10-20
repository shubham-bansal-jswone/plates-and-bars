package app.plateandbar.labelscan

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class TurnTest {
  @Test fun `scans never overlap`() = runBlocking {
    val inside = AtomicInteger()
    var most = 0
    val jobs = (1..6).map {
      async {
        Turn.run {
          most = maxOf(most, inside.incrementAndGet())
          Thread.sleep(10)
          inside.decrementAndGet()
        }
      }
    }
    jobs.awaitAll()
    assertEquals(1, most)
  }

  @Test fun `the work runs off the calling thread, on the CPU pool`() = runBlocking {
    val caller = Thread.currentThread()
    val worker = Turn.run { Thread.currentThread() }
    assertNotEquals(caller, worker)
  }

  @Test fun `a failing scan frees the turn for the next one`() = runBlocking {
    try {
      Turn.run { throw IllegalStateException("boom") }
    } catch (e: IllegalStateException) {
      // expected
    }
    assertEquals(5, Turn.run { 5 })
  }
}
