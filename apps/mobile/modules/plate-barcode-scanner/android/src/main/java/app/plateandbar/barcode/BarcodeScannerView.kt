package app.plateandbar.barcode

import android.content.Context
import android.util.Size
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import zxingcpp.BarcodeReader

/**
 * Camera preview plus a frame analyser. Frames are decoded in memory by zxing-cpp and dropped: nothing is written to disk,
 * kept, or sent anywhere. Reads one barcode, then waits until `active` goes false and true again.
 */
class BarcodeScannerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onBarcode by EventDispatcher<Map<String, Any>>()
  private val onReady by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()

  // EAN-8, EAN-13, UPC-A, UPC-E only: no QR codes, so a printed link is never read.
  private val reader = BarcodeReader(
    BarcodeReader.Options(
      formats = setOf(
        BarcodeReader.Format.EAN_13,
        BarcodeReader.Format.EAN_8,
        BarcodeReader.Format.UPC_A,
        BarcodeReader.Format.UPC_E,
      ),
      tryRotate = true,
      tryInvert = false,
    ),
  )
  private val preview = PreviewView(context).apply {
    layoutParams = LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    scaleType = PreviewView.ScaleType.FILL_CENTER
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }
  // One executor per start: a detach shuts it down and the next attach makes a new one.
  private var analysisExecutor: ExecutorService? = null
  private val reading = AtomicBoolean(true)
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var torchWanted = false
  private var started = false
  // Bumped on every release, so a camera-provider callback from an earlier start is ignored.
  private var generation = 0

  override val shouldUseAndroidLayout = true

  init {
    addView(preview)
  }

  fun setTorch(on: Boolean) {
    torchWanted = on
    camera?.takeIf { it.cameraInfo.hasFlashUnit() }?.cameraControl?.enableTorch(on)
  }

  fun setActive(on: Boolean) {
    reading.set(on)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!started) start()
  }

  private fun start() {
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      onError(mapOf("message" to "no_activity"))
      return
    }
    started = true
    val gen = generation
    val executor = Executors.newSingleThreadExecutor()
    analysisExecutor = executor
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (gen != generation) return@addListener
      try {
        val cameraProvider = future.get()
        provider = cameraProvider
        val previewUseCase = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
        // Small frames are enough for a barcode on the pack and keep memory low on a 2 to 3 GB phone.
        val analysis = ImageAnalysis.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setResolutionStrategy(
                ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
              )
              .build(),
          )
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()
        analysis.setAnalyzer(executor) { image ->
          try {
            if (reading.get()) {
              val hit = reader.read(image).firstOrNull()
              if (hit != null && !hit.text.isNullOrEmpty() && reading.compareAndSet(true, false)) {
                val code: String = hit.text ?: ""
                val format = hit.format.name
                post { onBarcode(mapOf("code" to code, "format" to format)) }
              }
            }
          } finally {
            image.close()
          }
        }
        cameraProvider.unbindAll()
        val bound = cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, previewUseCase, analysis)
        camera = bound
        val hasTorch = bound.cameraInfo.hasFlashUnit()
        if (hasTorch && torchWanted) bound.cameraControl.enableTorch(true)
        onReady(mapOf("torch" to hasTorch))
      } catch (e: Exception) {
        onError(mapOf("message" to (e.message ?: "camera_failed")))
      }
    }, ContextCompat.getMainExecutor(context))
  }

  /** Unbinds the camera and drops the analyser thread; the next attach starts again (a screen can detach this view while another covers it). */
  fun stop() {
    generation++
    started = false
    try {
      provider?.unbindAll()
    } catch (_: Exception) {
      // already gone
    }
    camera = null
    analysisExecutor?.shutdown()
    analysisExecutor = null
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    stop()
  }
}
