package app.plateandbar.api.ai;

/** The AI features: four text calls (v1) and three image calls (v1.1, ADR 008). {@code key} is the contract's name and the value stored in ai_usage. */
public enum AiFeature {
    DESCRIBE_MEAL("describe_meal"),
    ASK_WHY("ask_why"),
    WEEKLY_SUMMARY("weekly_summary"),
    SUGGEST_TAGS("suggest_tags"),
    MEAL_PHOTO("meal_photo"),
    IMPORT_RECIPE("import_recipe"),
    FORM_CHECK("form_check");

    private final String key;

    AiFeature(String key) {
        this.key = key;
    }

    public String key() {
        return key;
    }

    /** True for the image calls: their replies are never cached, and they take a 2 MB body instead of 16 KB. */
    public boolean isImageCall() {
        return this == MEAL_PHOTO || this == IMPORT_RECIPE || this == FORM_CHECK;
    }
}
