package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.JSON;
import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.foodLog;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.naturalId;
import static app.plateandbar.api.sync.SyncFixtures.obj;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.support.WebMvcAuthSlice;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** Request validation and the authenticated-user rule, with the real validator and a mocked engine. */
@WebMvcTest(SyncController.class)
@WebMvcAuthSlice
@Import(SyncRequestValidator.class)
class SyncControllerTest {

    static final String USER = "11111111-1111-1111-1111-111111111111";
    static final String T = "2026-10-08T07:12:45Z";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @MockitoBean SyncService service;

    private ResultActions send(String user, String body) throws Exception {
        return mvc.perform(post("/api/v1/sync")
                .header("Authorization", "Bearer " + jwt.issue(user).value())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private static String body(ObjectNode n) {
        return n.toString();
    }

    @Test
    void withoutTokenIs401() throws Exception {
        mvc.perform(post("/api/v1/sync").contentType(MediaType.APPLICATION_JSON).content("{\"cursor\":null,\"changes\":{}}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"));
        verifyNoInteractions(service);
    }

    @Test
    void validRequestIsHandedToTheEngineForTheTokensUserAndItsAnswerIsReturned() throws Exception {
        String logId = id();
        ObjectNode answer = obj("{'cursor':'c_0000000000000001','has_more':false,'applied':[],'conflicts':[],'changes':{}}");
        when(service.sync(eq(USER), any())).thenReturn(answer);

        send(USER, body(Req.of(null).add(SyncTable.food_logs, foodLog(logId, 0, T, null, "Poha", 291)).build()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cursor").value("c_0000000000000001"))
                .andExpect(jsonPath("$.has_more").value(false));

        ArgumentCaptor<SyncRequestValidator.Parsed> parsed = ArgumentCaptor.forClass(SyncRequestValidator.Parsed.class);
        verify(service).sync(eq(USER), parsed.capture());
        assertThat(parsed.getValue().records()).singleElement().satisfies(r -> {
            assertThat(r.table()).isEqualTo(SyncTable.food_logs);
            assertThat(r.id()).isEqualTo(logId);
            assertThat(r.version()).isZero();
            assertThat(r.data().get("name").asText()).isEqualTo("Poha");
            assertThat(r.data().has("id")).isFalse();
        });
    }

    @Test
    void aUserIdInThePayloadIsNeverUsedAndNeverStored() throws Exception {
        when(service.sync(any(), any())).thenReturn(obj("{'cursor':'c_0000000000000000'}"));
        ObjectNode rec = waterLog(id(), 0, T, null, 250);
        rec.put("user_id", "22222222-2222-2222-2222-222222222222");
        ObjectNode req = Req.of(null).add(SyncTable.water_logs, rec).build();
        req.put("user_id", "22222222-2222-2222-2222-222222222222");

        send(USER, body(req)).andExpect(status().isOk());

        ArgumentCaptor<SyncRequestValidator.Parsed> parsed = ArgumentCaptor.forClass(SyncRequestValidator.Parsed.class);
        verify(service).sync(eq(USER), parsed.capture());
        assertThat(parsed.getValue().records().get(0).data().has("user_id")).isFalse();
    }

    @Test
    void idsAreLowerCasedSoOneRecordCannotHaveTwoSpellings() throws Exception {
        when(service.sync(any(), any())).thenReturn(obj("{'cursor':'c_0000000000000000'}"));
        String upper = id().toUpperCase();
        send(USER, body(Req.of(null).add(SyncTable.water_logs, waterLog(upper, 0, T, null, 250)).build()))
                .andExpect(status().isOk());
        ArgumentCaptor<SyncRequestValidator.Parsed> parsed = ArgumentCaptor.forClass(SyncRequestValidator.Parsed.class);
        verify(service).sync(eq(USER), parsed.capture());
        assertThat(parsed.getValue().records().get(0).id()).isEqualTo(upper.toLowerCase());
    }

    @Test
    void naturalKeyRecordsMustUseTheUsersDeterministicId() throws Exception {
        when(service.sync(any(), any())).thenReturn(obj("{'cursor':'c_0000000000000000'}"));
        Map<SyncTable, ObjectNode> all = SyncFixtures.oneOfEach(USER, T);
        send(USER, body(Req.of(null).add(SyncTable.day_notes, all.get(SyncTable.day_notes)).build()))
                .andExpect(status().isOk());

        ObjectNode wrong = all.get(SyncTable.day_notes).deepCopy();
        wrong.put("id", naturalId("22222222-2222-2222-2222-222222222222", "day_notes", "2026-10-08"));
        send(USER, body(Req.of(null).add(SyncTable.day_notes, wrong).build()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.details[0].field").value("changes.day_notes[0].id"));
    }

    @Test
    void everyTableAcceptsItsContractExample() throws Exception {
        when(service.sync(any(), any())).thenReturn(obj("{'cursor':'c_0000000000000000'}"));
        for (Map.Entry<SyncTable, ObjectNode> e : SyncFixtures.oneOfEach(USER, T).entrySet()) {
            send(USER, body(Req.of(null).add(e.getKey(), e.getValue()).build()))
                    .andExpect(status().isOk());
        }
    }

    static Stream<Arguments> invalidBodies() {
        ObjectNode ok = Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250)).build();
        return Stream.of(
                Arguments.of("missing cursor", "{\"changes\":{}}"),
                Arguments.of("missing changes", "{\"cursor\":null}"),
                Arguments.of("cursor wrong type", "{\"cursor\":5,\"changes\":{}}"),
                Arguments.of("cursor not ours", "{\"cursor\":\"hello\",\"changes\":{}}"),
                Arguments.of("unknown table", "{\"cursor\":null,\"changes\":{\"labs\":[]}}"),
                Arguments.of("changes is an array", "{\"cursor\":null,\"changes\":[]}"),
                Arguments.of("table is not an array", "{\"cursor\":null,\"changes\":{\"water_logs\":{}}}"),
                Arguments.of("body is an array", "[]"),
                Arguments.of("body is null", "null"),
                Arguments.of("not json", "{"),
                Arguments.of("empty body", ""),
                Arguments.of("meal not in enum", mutate(ok, "meal", "Brunch", SyncTable.food_logs)),
                Arguments.of("ml zero", mutate(ok, "ml", 0, SyncTable.water_logs)),
                Arguments.of("ml above 5000", mutate(ok, "ml", 5001, SyncTable.water_logs)),
                Arguments.of("ml not an integer", mutate(ok, "ml", 2.5, SyncTable.water_logs)),
                Arguments.of("date not a date", mutate(ok, "date", "08/10/2026", SyncTable.water_logs)),
                Arguments.of("updated_at without zone", mutate(ok, "updated_at", "2026-10-08T07:12:45", SyncTable.water_logs)),
                Arguments.of("updated_at null", mutate(ok, "updated_at", null, SyncTable.water_logs)),
                Arguments.of("negative version", mutate(ok, "version", -1, SyncTable.water_logs)),
                Arguments.of("version beyond int", mutate(ok, "version", 99999999999L, SyncTable.water_logs)),
                Arguments.of("id not a uuid", mutate(ok, "id", "abc", SyncTable.water_logs)),
                Arguments.of("id short form", mutate(ok, "id", "1-1-1-1-1", SyncTable.water_logs)),
                Arguments.of("deleted_at wrong type", mutate(ok, "deleted_at", 5, SyncTable.water_logs)),
                Arguments.of("missing field", removeField(ok, "ml", SyncTable.water_logs)),
                Arguments.of("missing meta", removeField(ok, "version", SyncTable.water_logs))
        );
    }

    private static String mutate(ObjectNode req, String field, Object value, SyncTable asTable) {
        ObjectNode copy = req.deepCopy();
        ObjectNode rec = (ObjectNode) copy.path("changes").path("water_logs").get(0);
        if (asTable == SyncTable.food_logs) {
            copy = Req.of(null).add(SyncTable.food_logs, foodLog(id(), 0, T, null, "Poha", 291)).build();
            rec = (ObjectNode) copy.path("changes").path("food_logs").get(0);
        }
        rec.set(field, JSON.valueToTree(value));
        return copy.toString();
    }

    private static String removeField(ObjectNode req, String field, SyncTable t) {
        ObjectNode copy = req.deepCopy();
        ((ObjectNode) copy.path("changes").path(t.name()).get(0)).remove(field);
        return copy.toString();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidBodies")
    void invalidRequestIs400InvalidRequestAndNothingReachesTheEngine(String name, String body) throws Exception {
        send(USER, body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.message").isString());
        verifyNoInteractions(service);
    }

    @Test
    void errorDetailsNameTheFieldNeverTheValue() throws Exception {
        ObjectNode rec = foodLog(id(), 0, T, null, "SECRET-FOOD-NAME", 291);
        rec.put("meal", "SECRET-MEAL");
        String res = send(USER, body(Req.of(null).add(SyncTable.food_logs, rec).build()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details[0].field").value("changes.food_logs[0].meal"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        assertThat(res).doesNotContain("SECRET");
    }

    @Test
    void aMissingFieldIsNamedByItsPath() throws Exception {
        send(USER, removeField(Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250)).build(), "ml", SyncTable.water_logs))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details[0].field").value("changes.water_logs[0].ml"))
                .andExpect(jsonPath("$.details[0].issue").value("required"));
    }

    @Test
    void oneBadRecordRejectsTheWholeRequest() throws Exception {
        ObjectNode bad = waterLog(id(), 0, T, null, 0);
        send(USER, body(Req.of(null)
                        .add(SyncTable.food_logs, foodLog(id(), 0, T, null, "Poha", 291))
                        .add(SyncTable.water_logs, bad)
                        .build()))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void capIs500RecordsInTotalAcrossTables() throws Exception {
        when(service.sync(any(), any())).thenReturn(obj("{'cursor':'c_0000000000000000'}"));
        Req half = Req.of(null);
        for (int i = 0; i < 250; i++) {
            half.add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250));
            half.add(SyncTable.food_logs, foodLog(id(), 0, T, null, "Poha", 291));
        }
        send(USER, body(half.build())).andExpect(status().isOk());

        half.add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250));
        send(USER, body(half.build()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.details[0].issue").value("too_many_records"));
    }

    @Test
    void recordCountIsCheckedBeforeSchemaValidation() throws Exception {
        // 501 records that are all schema-invalid: the answer is the cap, not 501 field problems.
        Req r = Req.of(null);
        for (int i = 0; i < 501; i++) {
            r.add(SyncTable.water_logs, obj("{'junk':true}"));
        }
        send(USER, body(r.build()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details.length()").value(1))
                .andExpect(jsonPath("$.details[0].issue").value("too_many_records"));
        verifyNoInteractions(service);
    }

    @Test
    void bodyLargerThanTheCapIs400TooLargeAndExactlyTheCapIsNotTooLarge() throws Exception {
        String padded = "{\"cursor\":null,\"changes\":{}," + "\"pad\":\"" + "x".repeat(2 * 1024 * 1024) + "\"}";
        send(USER, padded)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.details[0].issue").value("too_large"));
        verifyNoInteractions(service);

        when(service.sync(any(), any())).thenReturn(obj("{'cursor':'c_0000000000000000'}"));
        String base = "{\"cursor\":null,\"changes\":{},\"pad\":\"\"}";
        String exact = "{\"cursor\":null,\"changes\":{},\"pad\":\"" + "x".repeat(2 * 1024 * 1024 - base.length()) + "\"}";
        assertThat(exact.getBytes(java.nio.charset.StandardCharsets.UTF_8)).hasSize(2 * 1024 * 1024);
        send(USER, exact).andExpect(status().isOk());
    }

    @Test
    void sameIdTwiceInOneRequestIsRejected() throws Exception {
        String dup = id();
        send(USER, body(Req.of(null)
                        .add(SyncTable.water_logs, waterLog(dup, 0, T, null, 250))
                        .add(SyncTable.water_logs, waterLog(dup, 1, T, null, 300))
                        .build()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details[0].issue").value("duplicate"));
    }

    @Test
    void anOffsetTimestampIsAcceptedAndNormalisedToUtc() throws Exception {
        when(service.sync(any(), any())).thenReturn(obj("{'cursor':'c_0000000000000000'}"));
        send(USER, body(Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, "2026-10-08T12:42:45+05:30", null, 250)).build()))
                .andExpect(status().isOk());
        ArgumentCaptor<SyncRequestValidator.Parsed> parsed = ArgumentCaptor.forClass(SyncRequestValidator.Parsed.class);
        verify(service).sync(eq(USER), parsed.capture());
        assertThat(parsed.getValue().records().get(0).updatedAt().toString()).isEqualTo("2026-10-08T07:12:45Z");
    }

    @Test
    void validCursorShapeIsPassedThrough() throws Exception {
        when(service.sync(any(), any())).thenReturn(obj("{'cursor':'c_0000000000000000'}"));
        send(USER, "{\"cursor\":\"c_000000000000a3f1\",\"changes\":{}}").andExpect(status().isOk());
        ArgumentCaptor<SyncRequestValidator.Parsed> parsed = ArgumentCaptor.forClass(SyncRequestValidator.Parsed.class);
        verify(service).sync(eq(USER), parsed.capture());
        assertThat(parsed.getValue().cursor()).isEqualTo("c_000000000000a3f1");
        assertThat(parsed.getValue().records()).isEqualTo(List.of());
    }
}
