package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.common.ErrorResponse;
import tools.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/** Pins the exact error details for bad AI request bodies, so a validator library upgrade (#416) cannot change them. */
class AiSchemasDetailsTest {

    private static final AiSchemas SCHEMAS = new AiSchemas();
    private static final ObjectMapper JSON = new ObjectMapper();

    private static ErrorResponse.Detail d(String field, String issue) {
        return new ErrorResponse.Detail(field, issue);
    }

    static Stream<Arguments> cases() {
        return Stream.of(
                Arguments.of("DescribeMealRequest", "{}", List.of(d("text", "required"))),
                Arguments.of("DescribeMealRequest", "{\"text\":\"\"}", List.of(d("text", "minLength"), d("text", "pattern"))),
                Arguments.of("DescribeMealRequest", "{\"text\":\"   \"}", List.of(d("text", "pattern"))),
                Arguments.of("DescribeMealRequest", "{\"text\":5}", List.of(d("text", "type"))),
                Arguments.of("DescribeMealRequest", "{\"text\":\"oats\",\"secret\":\"x\"}", List.of(d("", "additionalProperties")) /* the key is never echoed */),
                Arguments.of("AskWhyRequest", "{\"card_id\":1}", List.of(d("card_id", "type"), d("question", "required"))),
                // 2.x: `$` no longer matches before a final newline (1.5.9 accepted this; stricter and correct).
                Arguments.of("AskWhyRequest", "{\"card_id\":\"protein\\n\",\"question\":\"why?\"}", List.of(d("card_id", "pattern"))),
                Arguments.of("DescribeMealRequest", "{\"text\":\"oats\"}", List.of()));
    }

    @ParameterizedTest(name = "{0} {1}")
    @MethodSource("cases")
    void details(String schema, String body, List<ErrorResponse.Detail> expected) throws Exception {
        List<ErrorResponse.Detail> got = SCHEMAS.problems(schema, JSON.readTree(body));
        assertThat(got).isEqualTo(expected);
    }
}
