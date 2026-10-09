package app.plateandbar.api.ai;

import org.springframework.stereotype.Component;

/** Canned replies, no network and no key. The only provider until one is chosen; flags are off by default. */
@Component
class StubAiProvider implements AiProvider {

    /** Canned text must never reach users, so every feature stays off (status and endpoints) while this is active. */
    @Override
    public boolean isStub() {
        return true;
    }

    @Override
    public Completion complete(AiFeature feature, String instructions, String input) {
        String text =
                switch (feature) {
                    case DESCRIBE_MEAL -> "{\"items\":[{\"name\":\"Roti\",\"qty\":\"2 medium\",\"kcal\":240,"
                            + "\"protein_g\":7,\"carbs_g\":46,\"fat_g\":3}]}";
                    case ASK_WHY -> "{\"answer\":\"The app's cards don't cover that yet. Please ask a coach, "
                            + "dietitian or doctor.\",\"card_id\":null}";
                    case WEEKLY_SUMMARY -> "{\"text\":\"You trained and logged food this week. Protein was the gap. "
                            + "Next week, aim to hit your protein target on more days.\"}";
                };
        return new Completion(text, (instructions.length() + input.length()) / 4, text.length() / 4);
    }
}
