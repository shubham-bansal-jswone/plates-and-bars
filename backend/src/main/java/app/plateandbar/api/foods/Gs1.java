package app.plateandbar.api.foods;

/**
 * The barcode rule of {@code GET /foods/barcode/{code}} (contract 0.1.23, vectors in
 * {@code packages/api/test-vectors/barcode-gs1.json}): ASCII digits only, length 8 (EAN-8), 12 (UPC-A) or 13 (EAN-13),
 * and a valid GS1 mod-10 check digit. GTIN-14 is not accepted.
 */
final class Gs1 {
    private Gs1() {}

    static boolean isValid(String code) {
        if (code == null) {
            return false;
        }
        int n = code.length();
        if (n != 8 && n != 12 && n != 13) {
            return false;
        }
        for (int i = 0; i < n; i++) {
            char c = code.charAt(i);
            if (c < '0' || c > '9') {
                return false;
            }
        }
        // From the digit before the check digit going left the weights are 3, 1, 3, 1, ...
        int sum = 0;
        int weight = 3;
        for (int i = n - 2; i >= 0; i--) {
            sum += (code.charAt(i) - '0') * weight;
            weight = 4 - weight;
        }
        return (10 - sum % 10) % 10 == code.charAt(n - 1) - '0';
    }
}
