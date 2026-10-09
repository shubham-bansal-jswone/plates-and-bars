package app.plateandbar.api.ai;

/** The three v1 AI features. {@code key} is the contract's name and the value stored in ai_usage. */
public enum AiFeature {
    DESCRIBE_MEAL("describe_meal"),
    ASK_WHY("ask_why"),
    WEEKLY_SUMMARY("weekly_summary");

    private final String key;

    AiFeature(String key) {
        this.key = key;
    }

    public String key() {
        return key;
    }
}
