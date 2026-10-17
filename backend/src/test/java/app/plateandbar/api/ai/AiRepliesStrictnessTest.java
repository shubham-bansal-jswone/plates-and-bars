package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

/**
 * Model replies are read leniently about trailing text (models add some) but not about duplicate keys, whatever the
 * shared request mapper does (#720). The mapper here is set up like application.yml: strict on both.
 */
class AiRepliesStrictnessTest {

    private final ObjectMapper json = new ObjectMapper().rebuild()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build();
    private final AiReplies replies = new AiReplies(json, new AiSchemas(), new AiContent(json));

    @Test
    void textAfterTheReplyJsonIsIgnored() {
        assertThat(replies.suggestTags("{\"difficulty\":3} Hope this helps!")).isPresent();
        assertThat(replies.suggestTags("{\"difficulty\":3}{\"difficulty\":1}").orElseThrow().path("difficulty").asInt())
                .isEqualTo(3);
    }

    @Test
    void aDuplicateKeyInTheReplyIsUnusable() {
        assertThat(replies.suggestTags("{\"difficulty\":3,\"difficulty\":1}")).isEmpty();
    }
}
