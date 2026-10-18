package app.plateandbar.api.foods;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * GET /foods/barcode/{code}: public (no sign-in), an Open Food Facts proxy (ADR 009). The per-IP limit is the rate-limit
 * filter's ({@code barcode-ip}); order of checks and errors are {@link BarcodeService}'s.
 */
@RestController
public class FoodsController {

    private final BarcodeService barcodes;

    public FoodsController(BarcodeService barcodes) {
        this.barcodes = barcodes;
    }

    @GetMapping("/api/v1/foods/barcode/{code}")
    public JsonNode barcode(@PathVariable String code) {
        return barcodes.lookup(code);
    }
}
