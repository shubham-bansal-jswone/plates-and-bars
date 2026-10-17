package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.common.ErrorResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The contract's blank-text vectors (packages/api/test-vectors/blank-text.json) against the real request schemas. */
class BlankTextVectorsTest {

    private static final AiSchemas SCHEMAS = new AiSchemas();
    private static final ObjectMapper JSON = new ObjectMapper();

    private static final JsonNode VECTORS = read();

    private static JsonNode read() {
        try {
            return JSON.readTree(Files.readAllBytes(Path.of("..", "packages", "api", "test-vectors", "blank-text.json")));
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static List<String[]> fields() {
        List<String[]> out = new ArrayList<>();
        VECTORS.path("fields").forEach(f -> out.add(f.asString().split("\\.")));
        assertThat(out).hasSize(3);
        return out;
    }

    private static List<ErrorResponse.Detail> problems(String[] field, String text) {
        var body = JSON.createObjectNode().put(field[1], text);
        if (field[0].equals("AskWhyRequest")) {
            body.put("card_id", "protein");
        }
        return SCHEMAS.problems(field[0], body);
    }

    @Test
    void mustFailTextsAreRefusedWithPatternOnEachField() {
        assertThat(VECTORS.path("must_fail").size()).isPositive();
        for (String[] f : fields()) {
            for (JsonNode t : VECTORS.path("must_fail")) {
                assertThat(problems(f, t.asString())).as("%s.%s %s", f[0], f[1], t.toString())
                        .contains(new ErrorResponse.Detail(f[1], "pattern"));
                assertThat(AiPrompts.isBlank(AiPrompts.sanitize(t.asString()))).isTrue();
            }
        }
    }

    @Test
    void mustPassTextsAreAccepted() {
        assertThat(VECTORS.path("must_pass").size()).isPositive();
        for (String[] f : fields()) {
            for (JsonNode t : VECTORS.path("must_pass")) {
                assertThat(problems(f, t.asString())).as("%s.%s %s", f[0], f[1], t.toString()).isEmpty();
                assertThat(AiPrompts.isBlank(AiPrompts.sanitize(t.asString()))).isFalse();
            }
        }
    }

    /** U+202E passes the schema, sanitising drops it, and the NBSP left is blank: 400 pattern, provider never called. */
    @Test
    void bidiControlPlusNbspIsRefusedAfterSanitising() {
        AiProvider provider = org.mockito.Mockito.mock(AiProvider.class);
        AiContent content = org.mockito.Mockito.mock(AiContent.class);
        org.mockito.Mockito.when(content.hasCard("protein")).thenReturn(true);
        AiQuotaService quotas = org.mockito.Mockito.mock(AiQuotaService.class);
        AiService service = new AiService(quotas, provider, SCHEMAS, content,
                org.mockito.Mockito.mock(AiReplies.class), JSON);
        String blank = "\u202E\u00A0";
        record C(String field, java.util.function.Consumer<JsonNode> call) { }
        for (C c : List.of(
                new C("text", b -> service.describeMeal("u", b)),
                new C("question", b -> service.askWhy("u", b)),
                new C("name", b -> service.suggestTags("u", b)))) {
            var body = JSON.createObjectNode().put(c.field(), blank);
            if (c.field().equals("question")) {
                body.put("card_id", "protein");
            }
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> c.call().accept(body))
                    .isInstanceOfSatisfying(app.plateandbar.api.common.ApiException.class, e ->
                            assertThat(e.details()).containsExactly(new ErrorResponse.Detail(c.field(), "pattern")));
        }
        org.mockito.Mockito.verifyNoInteractions(provider);
        org.mockito.Mockito.verify(quotas, org.mockito.Mockito.never()).reserve(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }
}
