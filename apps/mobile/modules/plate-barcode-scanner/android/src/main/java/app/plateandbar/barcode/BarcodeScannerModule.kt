package app.plateandbar.barcode

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * One view, no functions: the camera preview that reads EAN-8, EAN-13, UPC-A and UPC-E and reports the digits (#944).
 * The CAMERA permission is asked from JavaScript, which owns the rationale text.
 */
class BarcodeScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlateBarcodeScanner")

    View(BarcodeScannerView::class) {
      Events("onBarcode", "onReady", "onError")
      Prop("torch") { view: BarcodeScannerView, on: Boolean? -> view.setTorch(on == true) }
      // false pauses reading (the preview keeps running); true re-arms it after a read.
      Prop("active") { view: BarcodeScannerView, on: Boolean? -> view.setActive(on != false) }
      OnViewDestroys { view: BarcodeScannerView -> view.stop() }
    }
  }
}
