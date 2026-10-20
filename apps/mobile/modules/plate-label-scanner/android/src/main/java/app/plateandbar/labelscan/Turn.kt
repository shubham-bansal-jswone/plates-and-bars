package app.plateandbar.labelscan

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Scans take turns, and run on the CPU pool. A waiting scan suspends instead of holding a thread, and nothing here runs on Expo's one
 * shared async-function thread, so a 1 to 3 s scan never stalls the other modules' calls (file system, image picker, secure store).
 * Tesseract keeps big page buffers: two scans at once on a 2 GB phone would double the peak, hence one at a time.
 */
object Turn {
  private val mutex = Mutex()

  suspend fun <T> run(block: () -> T): T = mutex.withLock { withContext(Dispatchers.Default) { block() } }
}
