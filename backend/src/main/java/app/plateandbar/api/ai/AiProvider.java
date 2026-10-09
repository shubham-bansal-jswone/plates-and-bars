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

    Completion complete(AiFeature feature, String instructions, String input);
}
