package app.plateandbar.devicesteps

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * The phone's raw step counter (Sensor.TYPE_STEP_COUNTER): steps since the phone booted. Plain Android SensorManager, no Google Play
 * services. Turning readings into per-day steps is done in packages/core (advanceSteps); this only reads the sensor.
 * The ACTIVITY_RECOGNITION permission (API 29+) is requested from JavaScript; without it no reading arrives and the read gives null.
 */
class DeviceStepsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val sensorManager: SensorManager
    get() = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

  override fun definition() = ModuleDefinition {
    Name("DeviceSteps")

    AsyncFunction("isAvailableAsync") {
      sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
    }

    // { counter, elapsedMs } or null (no sensor, no permission, or no reading within the timeout).
    AsyncFunction("readCounterAsync") Coroutine { ->
      readCounter()
    }
  }

  private suspend fun readCounter(): Map<String, Double>? {
    val manager = sensorManager
    val sensor = manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return null
    return withTimeoutOrNull(READ_TIMEOUT_MS) {
      suspendCancellableCoroutine<Map<String, Double>?> { cont ->
        val listener = object : SensorEventListener {
          override fun onSensorChanged(event: SensorEvent) {
            manager.unregisterListener(this)
            if (cont.isActive) {
              cont.resume(mapOf("counter" to event.values[0].toDouble(), "elapsedMs" to SystemClock.elapsedRealtime().toDouble()))
            }
          }

          override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        cont.invokeOnCancellation { manager.unregisterListener(listener) }
        if (!manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)) {
          cont.resume(null)
        }
      }
    }
  }

  private companion object {
    const val READ_TIMEOUT_MS = 3000L
  }
}
