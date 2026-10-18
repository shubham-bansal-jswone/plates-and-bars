package app.plateandbar.api.ai;

/**
 * The one seam to a model provider. A real implementation (not chosen yet, #200) must use the cheapest model that
 * does the job, set connect and read timeouts, send only these two strings (never a user id or any account
 * data), ask the provider not to retain or train on them, and read its key from the environment. Any exception
 * it throws is a 503 {@code unavailable} and releases the reserved quota unit. Never log the arguments or the reply.
 */
public interface AiProvider {

    /** The model's raw reply text plus the tokens it cost, for the monthly budget. */
    record Completion(String text, int inputTokens, int outputTokens) {}

    /** True for a provider that returns canned replies: while it is the active one, every feature is off. */
    default boolean isStub() {
        return false;
    }

    Completion complete(AiFeature feature, String instructions, String input);

    /**
     * The image calls (ADR 008): the same, plus the images the server has already re-encoded as new JPEGs (EXIF and
     * GPS gone), in request order. A provider must hold them in memory only, never write them anywhere, and must
     * be set to no retention and no training (ADR 008, decision 5). The default refuses, so a text-only provider
     * answers 503 {@code unavailable} to an image call.
     */
    default Completion complete(AiFeature feature, String instructions, String input, java.util.List<byte[]> jpegImages) {
        if (jpegImages.isEmpty()) {
            return complete(feature, instructions, input);
        }
        throw new UnsupportedOperationException("this provider does not take images");
    }
}
