package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import app.plateandbar.api.support.ConcurrentListAppender;
import app.plateandbar.api.sync.ContractSchemas;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;

/** Meal photo, Import recipe and Form check end to end on real MySQL with a mocked provider (ADR 008). */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "app.ai.describe-meal-enabled=true",
            "app.ai.meal-photo-enabled=true",
            "app.ai.import-recipe-enabled=true",
            "app.ai.form-check-enabled=true",
            "app.ai.monthly-budget-tokens=1000000",
            "app.rate-limit.ai-per-user.capacity=1000",
            "app.rate-limit.ai-per-ip.capacity=100000",
            "app.rate-limit.authenticated-per-user.capacity=100000"
        })
@Import(AiITBase.Config.class)
class AiImageEndpointsIT extends AiITBase {

    static final String PHOTO = "/api/v1/ai/meal-photo";
    static final String RECIPE = "/api/v1/ai/import-recipe";
    static final String FORM = "/api/v1/ai/form-check";
    /** The first vector: an 8x8 PNG. */
    static final String PNG = AiImagesTest.VECTORS.path("cases").get(0).path("data").asString();
    static final String IMAGE = "{\"media_type\":\"image/png\",\"data\":\"" + PNG + "\"}";
    static final String MEAL_BODY = "{\"image\":" + IMAGE + ",\"hint\":\"2 rotis, cooked in 1 tsp ghee\"}";
    static final String FORM_BODY = "{\"exercise\":\"Goblet Squat\",\"frames\":[" + IMAGE + "," + IMAGE + "]}";
    static final String MEAL_REPLY = "{\"not_food\":false,\"items\":["
            + "{\"name\":\"Roti\",\"qty\":\"2 medium\",\"kcal\":240,\"protein_g\":7,\"carbs_g\":46,\"fat_g\":3,"
            + "\"confidence\":\"high\",\"match\":\"Roti / chapati\",\"servings\":2},"
            + "{\"name\":\"Bhindi sabzi\",\"qty\":\"1 katori\",\"kcal\":130,\"protein_g\":3,\"carbs_g\":12,\"fat_g\":8,"
            + "\"confidence\":\"unsure\",\"match\":\"Not a built-in food\",\"servings\":9}]}";
    static final String RECIPE_REPLY = "{\"name\":\"Dal tadka\",\"katoris\":6,\"ingredients\":["
            + "{\"ingredient\":\"toor dal (dry)\",\"as_written\":\"1 cup toor dal\",\"grams\":200},"
            + "{\"ingredient\":\"Unobtainium\",\"as_written\":\"1 pinch unobtainium\",\"grams\":5},"
            + "{\"ingredient\":\"Besan\",\"as_written\":\"2 tsp besan\",\"grams\":-3}],"
            + "\"steps\":[\"Pressure cook the dal.\"],\"unmatched\":[\"salt\"]}";
    static final String FORM_REPLY = "{\"visible\":true,\"checks\":["
            + "{\"cue\":\"Sit down between your heels with your chest up\",\"status\":\"good\",\"note\":\"\"},"
            + "{\"cue\":\"A cue the card does not have\",\"status\":\"good\",\"note\":\"x\"},"
            + "{\"cue\":\"Push your knees out in line with your toes\",\"status\":\"great\",\"note\":\"Knees drift in.\"}],"
            + "\"summary\":\"Solid depth.\"}";

    @MockitoBean AiProvider provider;

    @BeforeEach
    void setUp() {
        reset(provider);
        jdbc.update("DELETE FROM ai_usage");
        jdbc.update("DELETE FROM ai_spend_monthly");
        clock.advance(Duration.between(clock.instant(), START));
    }

    private void reply(String text) {
        when(provider.complete(any(), any(), any(), anyList())).thenReturn(new AiProvider.Completion(text, 100, 50));
    }

    private JsonNode body(ResponseEntity<String> r) throws Exception {
        return json.readTree(r.getBody());
    }

    @SuppressWarnings("unchecked")
    private List<byte[]> sentImages(AiFeature feature) {
        ArgumentCaptor<List<byte[]>> images = ArgumentCaptor.forClass(List.class);
        verify(provider).complete(eq(feature), any(), any(), images.capture());
        return images.getValue();
    }

    // ---- 200 ----

    @Test
    void mealPhotoReturnsCheckedItemsTheQuotaAndGroundsTheModelOnTheBuiltInFoods() throws Exception {
        reply(MEAL_REPLY);
        String u = newUser();
        var res = post(u, PHOTO, MEAL_BODY);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getHeaders().getFirst("Cache-Control")).isEqualTo("no-store");
        ContractSchemas.assertResponse("POST /ai/meal-photo", 200, res.getBody());
        JsonNode b = body(res);
        assertThat(b.path("not_food").asBoolean()).isFalse();
        assertThat(b.path("items").get(0).path("match").asString()).isEqualTo("Roti / chapati");
        assertThat(b.path("items").get(0).path("servings").asDouble()).isEqualTo(2);
        JsonNode second = b.path("items").get(1);
        assertThat(second.path("match").isNull()).isTrue(); // not a built-in food name
        assertThat(second.path("servings").asDouble()).isEqualTo(1);
        assertThat(second.path("confidence").asString()).isEqualTo("medium");
        assertThat(b.path("quota").path("remaining").asInt()).isEqualTo(9);
        assertThat(calls(u)).isEqualTo(1);
        ArgumentCaptor<String> in = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> instr = ArgumentCaptor.forClass(String.class);
        verify(provider).complete(eq(AiFeature.MEAL_PHOTO), instr.capture(), in.capture(), anyList());
        assertThat(in.getValue()).contains("Roti / chapati | 1 medium (30 g atta)", "2 rotis, cooked in 1 tsp ghee");
        assertThat(in.getValue() + instr.getValue()).doesNotContain(u).doesNotContain("@");
    }

    @Test
    void anEmptyPhotoIsNotFoodWithNoItems() throws Exception {
        reply("{\"not_food\":false,\"items\":[]}");
        var res = post(newUser(), PHOTO, "{\"image\":" + IMAGE + "}");
        ContractSchemas.assertResponse("POST /ai/meal-photo", 200, res.getBody());
        assertThat(body(res).path("not_food").asBoolean()).isTrue();
        assertThat(body(res).path("items").size()).isZero();
    }

    @Test
    void importRecipeMovesWhatDoesNotMatchToUnmatchedAndAcceptsTextAPhotoOrBoth() throws Exception {
        reply(RECIPE_REPLY);
        String u = newUser();
        var res = post(u, RECIPE, "{\"text\":\"Dal tadka: 1 cup toor dal, besan, salt\"}");
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        ContractSchemas.assertResponse("POST /ai/import-recipe", 200, res.getBody());
        JsonNode b = body(res);
        assertThat(b.path("ingredients")).hasSize(1);
        assertThat(b.path("ingredients").get(0).path("ingredient").asString()).isEqualTo("Toor dal (dry)");
        assertThat(b.path("ingredients").get(0).path("unit").asString()).isEqualTo("g");
        assertThat(b.path("unmatched")).extracting(JsonNode::asString)
                .containsExactly("1 pinch unobtainium", "2 tsp besan", "salt");
        assertThat(sentImages(AiFeature.IMPORT_RECIPE)).isEmpty(); // text only
        reset(provider);
        reply(RECIPE_REPLY);
        assertThat(post(u, RECIPE, "{\"image\":" + IMAGE + "}").getStatusCode().value()).isEqualTo(200);
        assertThat(sentImages(AiFeature.IMPORT_RECIPE)).hasSize(1);
        reset(provider);
        reply(RECIPE_REPLY);
        assertThat(post(u, RECIPE, "{\"text\":\"x y\",\"image\":" + IMAGE + "}").getStatusCode().value()).isEqualTo(200);
        assertThat(sentImages(AiFeature.IMPORT_RECIPE)).hasSize(1);
        assertThat(calls(u)).isEqualTo(3);
    }

    @Test
    void formCheckKeepsOnlyTheCardsOwnCuesVerbatimAndSendsEachFrameRecoded() throws Exception {
        reply(FORM_REPLY);
        var res = post(newUser(), FORM, FORM_BODY);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        ContractSchemas.assertResponse("POST /ai/form-check", 200, res.getBody());
        JsonNode b = body(res);
        assertThat(b.path("checks")).extracting(c -> c.path("cue").asString()).containsExactly(
                "Sit down between your heels with your chest up", "Push your knees out in line with your toes");
        assertThat(b.path("checks").get(1).path("status").asString()).isEqualTo("unclear"); // "great" is not a status
        ArgumentCaptor<String> in = ArgumentCaptor.forClass(String.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<byte[]>> images = ArgumentCaptor.forClass(List.class);
        verify(provider).complete(eq(AiFeature.FORM_CHECK), any(), in.capture(), images.capture());
        assertThat(in.getValue()).contains("Goblet Squat", "Sit down between your heels with your chest up");
        assertThat(images.getValue()).hasSize(2);
        images.getValue().forEach(i -> assertThat(i[0] & 0xFF).isEqualTo(0xFF)); // a JPEG, not the PNG that was sent
    }

    @Test
    void aCustomExerciseIsRefusedOnTheExerciseFieldBeforeTheQuota() throws Exception {
        String u = newUser();
        var res = post(u, FORM, "{\"exercise\":\"My Secret Lift\",\"frames\":[" + IMAGE + "," + IMAGE + "]}");
        assertThat(res.getStatusCode().value()).isEqualTo(400);
        ContractSchemas.assertResponse("POST /ai/form-check", 400, res.getBody());
        assertThat(body(res).path("details").get(0).path("field").asString()).isEqualTo("exercise");
        assertThat(res.getBody()).doesNotContain("Secret");
        assertThat(calls(u)).isZero();
        verify(provider, never()).complete(any(), any(), any(), anyList());
    }

    // ---- what the provider is given ----

    @Test
    void theProviderGetsANewJpegWithNoExifOrGpsAndNeverTheOriginalBytes() {
        reply(MEAL_REPLY);
        byte[] original = AiImagesTest.ofVector("jpeg ok, carries EXIF");
        post(newUser(), PHOTO, "{\"image\":{\"media_type\":\"image/jpeg\",\"data\":\""
                + Base64.getEncoder().encodeToString(original) + "\"}}");
        byte[] sent = sentImages(AiFeature.MEAL_PHOTO).get(0);
        assertThat(sent).isNotEqualTo(original);
        assertThat(sent[0] & 0xFF).isEqualTo(0xFF);
        assertThat(sent[1] & 0xFF).isEqualTo(0xD8);
        String text = new String(sent, StandardCharsets.ISO_8859_1);
        assertThat(text).doesNotContain("Exif").doesNotContain("MM\0*").doesNotContain("II*\0").doesNotContain("http://ns.adobe.com");
        for (int p = 2; p + 4 <= sent.length && (sent[p] & 0xFF) == 0xFF && (sent[p + 1] & 0xFF) != 0xDA; ) {
            assertThat(sent[p + 1] & 0xFF).as("no APP1 segment").isNotEqualTo(0xE1);
            p += 2 + ((sent[p + 2] & 0xFF) << 8 | (sent[p + 3] & 0xFF));
        }
        // the GPS IFD pointer (tag 0x8825) is in the original and not in the output
        assertThat(new String(original, StandardCharsets.ISO_8859_1)).contains("\u0088%");
        assertThat(text).doesNotContain("\u0088%");
    }

    @Test
    void imageCallsAreNeverCachedNotEvenForAnIdenticalRequestOrATextOnlyRecipe() {
        reply(MEAL_REPLY);
        String u = newUser();
        post(u, PHOTO, MEAL_BODY);
        post(u, PHOTO, MEAL_BODY);
        verify(provider, times(2)).complete(eq(AiFeature.MEAL_PHOTO), any(), any(), anyList());
        reply(RECIPE_REPLY);
        post(u, RECIPE, "{\"text\":\"same text\"}");
        post(u, RECIPE, "{\"text\":\"same text\"}");
        verify(provider, times(2)).complete(eq(AiFeature.IMPORT_RECIPE), any(), any(), anyList());
        assertThat(calls(u)).isEqualTo(4);
    }

    // ---- the vectors over HTTP ----

    @Test
    void everyImageVectorGivesItsContractOutcomeOverHttpAndAFaultCostsNothing() throws Exception {
        String u = newUser();
        int faults = 0;
        for (JsonNode c : AiImagesTest.VECTORS.path("cases")) {
            boolean frame = c.path("kind").asString().equals("frame");
            reset(provider);
            reply(frame ? FORM_REPLY : MEAL_REPLY);
            String img = json.createObjectNode().put("media_type", c.path("media_type").asString())
                    .put("data", AiImagesTest.dataOf(c)).toString(); // escapes the line break of one vector
            var res = frame
                    ? post(u, FORM, "{\"exercise\":\"Goblet Squat\",\"frames\":[" + IMAGE + "," + img + "]}")
                    : post(u, PHOTO, "{\"image\":" + img + "}");
            String name = c.path("name").asString();
            if (c.path("issue").isNull()) {
                assertThat(res.getStatusCode().value()).as(name).isEqualTo(200);
                ContractSchemas.assertResponse(frame ? "POST /ai/form-check" : "POST /ai/meal-photo", 200, res.getBody());
            } else {
                faults++;
                assertThat(res.getStatusCode().value()).as(name).isEqualTo(400);
                ContractSchemas.assertResponse(frame ? "POST /ai/form-check" : "POST /ai/meal-photo", 400, res.getBody());
                JsonNode d = body(res).path("details");
                assertThat(d).as(name).hasSize(1);
                assertThat(d.get(0).path("issue").asString()).as(name).isEqualTo(c.path("issue").asString());
                String field = (frame ? "frames[1]." : "image.")
                        + (c.path("issue").asString().equals("unsupported_type") ? "media_type" : "data");
                assertThat(d.get(0).path("field").asString()).as(name).isEqualTo(field);
                assertThat(res.getBody()).as(name).doesNotContain(AiImagesTest.dataOf(c).substring(0, Math.min(8, AiImagesTest.dataOf(c).length())));
                verify(provider, never()).complete(any(), any(), any(), anyList());
            }
        }
        assertThat(faults).isGreaterThanOrEqualTo(20);
        assertThat(calls(u)).as("only the accepted images used a unit").isEqualTo(
                (int) java.util.stream.StreamSupport.stream(AiImagesTest.VECTORS.path("cases").spliterator(), false)
                        .filter(c -> c.path("issue").isNull()).count());
    }

    @Test
    void aWrongShapeIsTheSchemasProblemAndAnImageFaultNeverNamesAnotherField() throws Exception {
        String u = newUser();
        for (String bad : new String[] {"{}", "{\"image\":{\"data\":\"" + PNG + "\"}}", "{\"image\":" + IMAGE + ",\"zzz\":1}",
            "{\"image\":" + IMAGE + ",\"hint\":\"   \"}", "{\"image\":\"" + PNG + "\"}",
            "{\"image\":{\"media_type\":\"image/png\",\"data\":5}}"}) {
            var res = post(u, PHOTO, bad);
            assertThat(res.getStatusCode().value()).as(bad).isEqualTo(400);
            ContractSchemas.assertResponse("POST /ai/meal-photo", 400, res.getBody());
            assertThat(res.getBody()).doesNotContain("zzz");
        }
        for (String bad : new String[] {"{}", "{\"text\":\"\\u200b \"}", "{\"text\":\"x\",\"zzz\":1}"}) {
            var res = post(u, RECIPE, bad);
            assertThat(res.getStatusCode().value()).as(bad).isEqualTo(400);
            ContractSchemas.assertResponse("POST /ai/import-recipe", 400, res.getBody());
        }
        for (String bad : new String[] {"{\"exercise\":\"Goblet Squat\",\"frames\":[" + IMAGE + "]}",
            "{\"exercise\":\"Goblet Squat\",\"frames\":[" + IMAGE + "," + IMAGE + "," + IMAGE + "," + IMAGE + "," + IMAGE + "]}",
            "{\"frames\":[" + IMAGE + "," + IMAGE + "]}"}) {
            var res = post(u, FORM, bad);
            assertThat(res.getStatusCode().value()).as(bad).isEqualTo(400);
            ContractSchemas.assertResponse("POST /ai/form-check", 400, res.getBody());
        }
        assertThat(calls(u)).isZero();
        verify(provider, never()).complete(any(), any(), any(), anyList());
    }

    @Test
    void aBodyOverTwoMegabytesIs400TooLargeAndABodyJustUnderItIsRead() throws Exception {
        String u = newUser();
        String over = "{\"image\":" + IMAGE + ",\"hint\":\"" + "a".repeat(2 * 1024 * 1024) + "\"}";
        var res = post(u, PHOTO, over);
        assertThat(res.getStatusCode().value()).isEqualTo(400);
        ContractSchemas.assertResponse("POST /ai/meal-photo", 400, res.getBody());
        assertThat(body(res).path("details").get(0).path("issue").asString()).isEqualTo("too_large");
        assertThat(calls(u)).isZero();
    }

    // ---- quota, failures, auth ----

    @Test
    void theQuotaIsSharedWithTheTextCallsAnImageFaultIsStill400WhenItIsUsedUpAndTheNextValidCallIs429() throws Exception {
        reply(MEAL_REPLY);
        when(provider.complete(eq(AiFeature.DESCRIBE_MEAL), any(), any()))
                .thenReturn(new AiProvider.Completion(AiEndpointsIT.MEAL, 1, 1));
        String u = newUser();
        for (int i = 0; i < 9; i++) {
            assertThat(post(u, PHOTO, MEAL_BODY).getStatusCode().value()).isEqualTo(200);
        }
        assertThat(post(u, DESCRIBE_PATH, "{\"text\":\"rice\"}").getStatusCode().value()).isEqualTo(200);
        assertThat(calls(u)).isEqualTo(10);
        for (String[] c : new String[][] {{"POST /ai/meal-photo", PHOTO, MEAL_BODY}, {"POST /ai/import-recipe", RECIPE, "{\"text\":\"dal\"}"},
            {"POST /ai/form-check", FORM, FORM_BODY}}) {
            var res = post(u, c[1], c[2]);
            assertThat(res.getStatusCode().value()).as(c[0]).isEqualTo(429);
            assertThat(res.getHeaders().getFirst("Retry-After")).isNotNull();
            ContractSchemas.assertResponse(c[0], 429, res.getBody());
            assertThat(body(res).path("code").asString()).isEqualTo("quota_exceeded");
        }
        // Validation comes before the quota, so a bad image is a 400 even now.
        var bad = post(u, PHOTO, "{\"image\":{\"media_type\":\"image/gif\",\"data\":\"" + PNG + "\"}}");
        assertThat(bad.getStatusCode().value()).isEqualTo(400);
        assertThat(calls(u)).isEqualTo(10);
        assertThat(post(newUser(), PHOTO, MEAL_BODY).getStatusCode().value()).isEqualTo(200); // another user is unaffected
    }

    static final String DESCRIBE_PATH = "/api/v1/ai/describe-meal";

    @Test
    void whenBothDecodePermitsAreTakenAnImageCallIs503WithRetryAfterCostsNothingAndTheNextCallWorks() throws Exception {
        String u = newUser();
        reply(MEAL_REPLY);
        AiImages.PERMITS.acquire(AiImages.MAX_CONCURRENT);
        try {
            for (String[] c : new String[][] {{"POST /ai/meal-photo", PHOTO, MEAL_BODY}, {"POST /ai/import-recipe", RECIPE,
                "{\"image\":" + IMAGE + "}"}, {"POST /ai/form-check", FORM, FORM_BODY}}) {
                var res = post(u, c[1], c[2]);
                assertThat(res.getStatusCode().value()).as(c[0]).isEqualTo(503);
                assertThat(res.getHeaders().getFirst("Retry-After")).as(c[0]).isEqualTo("2");
                ContractSchemas.assertResponse(c[0], 503, res.getBody());
                assertThat(body(res).path("code").asString()).isEqualTo("unavailable");
            }
            assertThat(calls(u)).as("the unit is not taken").isZero();
            verify(provider, never()).complete(any(), any(), any(), anyList());
        } finally {
            AiImages.PERMITS.release(AiImages.MAX_CONCURRENT);
        }
        assertThat(post(u, PHOTO, MEAL_BODY).getStatusCode().value()).isEqualTo(200);
        assertThat(calls(u)).isEqualTo(1);
        assertThat(AiImages.PERMITS.availablePermits()).isEqualTo(AiImages.MAX_CONCURRENT);
    }

    @Test
    void aProviderFailureIs503UnavailableAndReleasesTheUnitABilledUnusableReplyKeepsIt() throws Exception {
        String u = newUser();
        when(provider.complete(any(), any(), any(), anyList())).thenThrow(new RuntimeException("boom"));
        for (String[] c : new String[][] {{"POST /ai/meal-photo", PHOTO, MEAL_BODY}, {"POST /ai/import-recipe", RECIPE, "{\"text\":\"dal\"}"},
            {"POST /ai/form-check", FORM, FORM_BODY}}) {
            var res = post(u, c[1], c[2]);
            assertThat(res.getStatusCode().value()).as(c[0]).isEqualTo(503);
            ContractSchemas.assertResponse(c[0], 503, res.getBody());
            assertThat(body(res).path("code").asString()).isEqualTo("unavailable");
        }
        assertThat(calls(u)).isZero();
        reset(provider);
        reply("not json at all");
        for (String[] c : new String[][] {{PHOTO, MEAL_BODY}, {RECIPE, "{\"text\":\"dal\"}"}, {FORM, FORM_BODY}}) {
            assertThat(post(u, c[0], c[1]).getStatusCode().value()).as(c[0]).isEqualTo(503);
        }
        assertThat(calls(u)).isEqualTo(3);
    }

    @Test
    void aReplyThatDoesNotFitStaysAnImageCallsOwnShape() {
        String u = newUser();
        reply("{\"visible\":\"yes\"}");
        assertThat(post(u, FORM, FORM_BODY).getStatusCode().value()).isEqualTo(503);
        reply("{\"items\":\"none\"}");
        assertThat(post(u, PHOTO, MEAL_BODY).getStatusCode().value()).isEqualTo(503);
    }

    @Test
    void needsAToken() {
        for (String[] c : new String[][] {{"POST /ai/meal-photo", PHOTO, MEAL_BODY}, {"POST /ai/import-recipe", RECIPE, "{\"text\":\"dal\"}"},
            {"POST /ai/form-check", FORM, FORM_BODY}}) {
            var res = post(null, c[1], c[2]);
            assertThat(res.getStatusCode().value()).as(c[0]).isEqualTo(401);
            ContractSchemas.assertResponse(c[0], 401, res.getBody());
        }
    }

    // ---- no logging ----

    @Test
    void neitherTheImageNorTheTextNorTheReplyIsLoggedOrStored() {
        Logger root = (Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        ConcurrentListAppender logs = new ConcurrentListAppender();
        logs.start();
        root.addAppender(logs);
        try {
            String u = newUser();
            String token = jwt.issue(u).value();
            byte[] exif = AiImagesTest.ofVector("jpeg ok, carries EXIF");
            String data = Base64.getEncoder().encodeToString(exif);
            String img = "{\"media_type\":\"image/jpeg\",\"data\":\"" + data + "\"}";
            reply("{\"not_food\":false,\"items\":[{\"name\":\"Zorblax stew\",\"qty\":\"\",\"kcal\":1,\"protein_g\":1,"
                    + "\"carbs_g\":1,\"fat_g\":1,\"confidence\":\"low\",\"match\":null,\"servings\":1}]}");
            post(u, PHOTO, "{\"image\":" + img + ",\"hint\":\"quibblehint\"}");
            post(u, PHOTO, "{\"image\":" + img + ",\"zzz\":\"leakme\"}");
            post(u, PHOTO, "{\"image\":{\"media_type\":\"image/png\",\"data\":\"" + data + "\"}}"); // type_mismatch
            post(u, RECIPE, "{\"text\":\"quibbletext\",\"image\":" + img + "}");
            post(u, FORM, "{\"exercise\":\"Goblet Squat\",\"frames\":[" + img + "," + img + "]}");
            when(provider.complete(any(), any(), any(), anyList())).thenThrow(new RuntimeException("quibblehint " + data));
            post(u, PHOTO, "{\"image\":" + img + ",\"hint\":\"quibblehint again\"}");
            String all = String.join("\n", logs.list.stream().map(ILoggingEvent::getFormattedMessage).toList())
                    + logs.list.stream().map(e -> String.valueOf(e.getThrowableProxy())).reduce("", String::concat);
            assertThat(all).doesNotContain("quibble").doesNotContain("Zorblax").doesNotContain("leakme")
                    .doesNotContain(token).doesNotContain(data.substring(0, 60)).doesNotContain("Exif");
            assertThat(all).contains("AI call: user " + u + " feature meal_photo status 200")
                    .contains("feature meal_photo status 400");
            assertThat(jdbc.queryForList("SELECT CONCAT_WS(',', user_id, day, feature) FROM ai_usage", String.class).toString())
                    .doesNotContain("quibble");
        } finally {
            root.detachAppender(logs);
        }
    }
}
