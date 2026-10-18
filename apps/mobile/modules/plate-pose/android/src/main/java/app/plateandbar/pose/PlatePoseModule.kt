package app.plateandbar.pose

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Live pose tracking on Android (#947): one view, the front camera with MoveNet keypoints streamed to JavaScript, and one function that
 * checks the bundled model's hash. Camera frames are read in memory and dropped: nothing is written to disk, kept, or sent anywhere.
 * The CAMERA permission is asked from JavaScript, which owns the rationale text.
 */
class PlatePoseModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlatePose")

    // Copies the bundled model to private storage if needed, checks its sha256 against the pinned value, and reports the hash.
    AsyncFunction("verifyModel") {
      val context = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "no_context", null)
      try {
        val model = ModelFile.ensure(context)
        mapOf("sha256" to model.sha256, "bytes" to model.file.length().toDouble())
      } catch (e: ModelFile.Mismatch) {
        throw CodedException("ERR_MODEL_HASH", "model_hash_mismatch", e)
      }
    }

    View(PlatePoseView::class) {
      Events("onPose", "onReady", "onError")
      // false pauses tracking (the preview keeps running).
      Prop("active") { view: PlatePoseView, on: Boolean? -> view.setActive(on != false) }
      OnViewDestroys { view: PlatePoseView -> view.stop() }
    }
  }
}
