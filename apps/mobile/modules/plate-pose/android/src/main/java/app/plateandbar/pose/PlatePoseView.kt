package app.plateandbar.pose

import android.content.Context
import android.os.SystemClock
import android.util.Size
import android.view.ViewGroup
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import org.tensorflow.lite.Interpreter
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Camera preview plus a frame analyser. Each frame is converted on the CPU to 192 x 192 uint8, run through MoveNet in memory and
 * dropped: nothing is written to disk, kept, or sent anywhere. Only 17 keypoints (normalised, with scores), the frame size and a
 * timestamp go to JavaScript, at most about 12 times a second. The front camera is used (the user watches the screen while framing
 * the shot), the back one when there is no front one.
 *
 * Attach and detach are safe to repeat (a screen can detach this view while another covers it): stop() releases the camera, the model and
 * the analysis thread, and the next attach starts again with a fresh [Run].
 */
class PlatePoseView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onPose by EventDispatcher<Map<String, Any>>()
  private val onReady by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()

  private val preview = PreviewView(context).apply {
    layoutParams = LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    scaleType = PreviewView.ScaleType.FILL_CENTER
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }

  /**
   * Everything one start owns. One executor runs the model load, every frame and the model close, in that order, so the model is never
   * closed mid-frame. `live` goes false at stop(), and every callback of this run checks it, so nothing from an earlier start leaks
   * into the next one.
   */
  private class Run(val executor: ExecutorService) {
    @Volatile var live = true
    // touched only on `executor`'s thread
    var interpreter: Interpreter? = null
    val converter = FrameConverter(192)
    val output = Keypoints.emptyOutput()
    val throttle = FrameThrottle()
  }

  private var run: Run? = null
  private var provider: ProcessCameraProvider? = null
  private val tracking = AtomicBoolean(true)

  override val shouldUseAndroidLayout = true

  init {
    addView(preview)
  }

  fun setActive(on: Boolean) {
    tracking.set(on)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (run == null) start()
  }

  private fun start() {
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      onError(mapOf("message" to "no_activity"))
      return
    }
    val r = Run(Executors.newSingleThreadExecutor())
    run = r
    r.executor.execute {
      try {
        val model = ModelFile.ensure(context)
        r.interpreter = Interpreter(model.file, Interpreter.Options().apply { setNumThreads(2) })
      } catch (e: Throwable) {
        fail(r, if (e is ModelFile.Mismatch) "model_hash_mismatch" else "model_failed")
      }
    }

    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!r.live) return@addListener
      try {
        val cameraProvider = future.get()
        provider = cameraProvider
        val previewUseCase = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
        // Small frames are enough: the model sees 192 x 192, and a small buffer keeps memory low on a 2 to 3 GB phone.
        val analysis = ImageAnalysis.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setResolutionStrategy(ResolutionStrategy(Size(320, 240), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
              .build(),
          )
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()
        analysis.setAnalyzer(r.executor) { image ->
          try {
            val model = r.interpreter
            if (r.live && model != null && tracking.get() && r.throttle.accept(SystemClock.elapsedRealtime())) {
              val plane = image.planes[0]
              val box = r.converter.convert(plane.buffer, plane.rowStride, plane.pixelStride, image.width, image.height, image.imageInfo.rotationDegrees)
              model.run(r.converter.input, r.output)
              val keypoints = Keypoints.toFrame(r.output, box)
              val t = SystemClock.elapsedRealtime().toDouble()
              post { if (r.live) onPose(mapOf("t" to t, "width" to box.frameWidth, "height" to box.frameHeight, "keypoints" to keypoints)) }
            }
          } catch (e: Throwable) {
            fail(r, "inference_failed")
          } finally {
            image.close()
          }
        }
        val selector = when {
          cameraProvider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) -> CameraSelector.DEFAULT_FRONT_CAMERA
          cameraProvider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) -> CameraSelector.DEFAULT_BACK_CAMERA
          else -> null
        }
        if (selector == null) {
          onError(mapOf("message" to "no_camera"))
          return@addListener
        }
        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(owner, selector, previewUseCase, analysis)
        onReady(mapOf("front" to (selector == CameraSelector.DEFAULT_FRONT_CAMERA)))
      } catch (e: Throwable) {
        onError(mapOf("message" to (e.message ?: "camera_failed")))
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun fail(r: Run, message: String) {
    post { if (r.live) onError(mapOf("message" to message)) }
  }

  /** Unbinds the camera, closes the model on the analysis thread (after any frame in flight) and ends that thread; the next attach starts again. */
  fun stop() {
    val r = run ?: return
    run = null
    r.live = false
    try {
      provider?.unbindAll()
    } catch (_: Exception) {
      // already gone
    }
    provider = null
    r.executor.execute {
      r.interpreter?.close()
      r.interpreter = null
    }
    r.executor.shutdown()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    stop()
  }
}
