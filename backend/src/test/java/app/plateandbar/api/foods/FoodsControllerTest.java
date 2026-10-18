package app.plateandbar.api.foods;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.UpstreamException;
import app.plateandbar.api.support.WebMvcAuthSlice;
import app.plateandbar.api.sync.ContractSchemas;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * GET /foods/barcode/{code} through the real security chain (service mocked): every documented status is checked against the
 * contract, the endpoint is public, and the per-IP scope ({@code barcode-ip}, 3 here) is its own and comes before validation.
 */
@WebMvcTest(FoodsController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = {
    "app.rate-limit.barcode-per-ip.capacity=3",
    "app.rate-limit.barcode-per-ip.window=60s",
    "app.rate-limit.authenticated-per-user.capacity=2",
    "app.rate-limit.authenticated-per-user.window=60s"
})
class FoodsControllerTest {

    private static final String OP = "GET /foods/barcode/{code}";
    private static final String CODE = "8901491101837";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String LAYS = """
            {"code":"8901491101837","name":"India's Magic Masala","brands":"Lay's","quantity":"50g","serving_size":null,
             "serving_quantity":null,"nutrition_data_per":"100g",
             "nutriments":{"energy-kcal_100g":554,"energy-kj_100g":2311.4,"proteins_100g":6.5,"carbohydrates_100g":52,"fat_100g":35,"fiber_100g":3.5},
             "completeness":0.8875,"states_tags":["en:nutrition-facts-completed"],"data_quality_errors_tags":[],
             "countries_tags":["en:india"],"last_modified_at":"2026-06-02T09:14:31Z",
             "source":{"code":"open_food_facts","name":"Open Food Facts","licence":"ODbL 1.0 / DbCL 1.0",
                       "url":"https://world.openfoodfacts.org/product/8901491101837","reference":"8901491101837"}}
            """;

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @MockitoBean BarcodeService barcodes;

    private static RequestPostProcessor from(String ip) {
        return r -> {
            r.setRemoteAddr(ip);
            return r;
        };
    }

    private String body(org.springframework.test.web.servlet.ResultActions r) throws Exception {
        return r.andReturn().getResponse().getContentAsString();
    }

    @Test
    void ok200IsTheOffProductAndNeedsNoSignIn() throws Exception {
        when(barcodes.lookup(CODE)).thenReturn(JSON.readTree(LAYS));
        var res = mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(CODE));
        ContractSchemas.assertResponse(OP, 200, body(res));
    }

    @Test
    void aGarbageBearerTokenIsIgnoredNotRefused() throws Exception {
        when(barcodes.lookup(CODE)).thenReturn(JSON.readTree(LAYS));
        mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.2")).header("Authorization", "Bearer garbage.token.value"))
                .andExpect(status().isOk());
    }

    @Test
    void invalidBarcode400() throws Exception {
        when(barcodes.lookup(anyString()))
                .thenThrow(new ApiException(HttpStatus.BAD_REQUEST, "invalid_barcode", "That is not a valid barcode. Check the digits."));
        var res = mvc.perform(get("/api/v1/foods/barcode/123").with(from("10.2.0.3")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_barcode"));
        ContractSchemas.assertResponse(OP, 400, body(res));
    }

    @Test
    void notFound404() throws Exception {
        when(barcodes.lookup(CODE)).thenThrow(new ApiException(HttpStatus.NOT_FOUND, "not_found", "No product found for this barcode."));
        var res = mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.4")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("not_found"));
        ContractSchemas.assertResponse(OP, 404, body(res));
    }

    @Test
    void upstreamUnavailable503HasNoRetryAfter() throws Exception {
        when(barcodes.lookup(CODE)).thenThrow(UpstreamException.unavailable());
        var res = mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.5")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().doesNotExist("Retry-After"))
                .andExpect(jsonPath("$.code").value("upstream_unavailable"));
        ContractSchemas.assertResponse(OP, 503, body(res));
    }

    @Test
    void upstreamBusy503CarriesRetryAfter() throws Exception {
        when(barcodes.lookup(CODE)).thenThrow(UpstreamException.busy(42));
        var res = mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.6")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "42"))
                .andExpect(jsonPath("$.code").value("upstream_busy"));
        ContractSchemas.assertResponse(OP, 503, body(res));
    }

    @Test
    void unexpectedFailure500IsTheErrorShape() throws Exception {
        when(barcodes.lookup(CODE)).thenThrow(new IllegalStateException("boom " + CODE));
        var res = mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.7")))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("internal"));
        assertThat(body(res)).doesNotContain(CODE);
        ContractSchemas.assertResponse(OP, 500, body(res));
    }

    @Test
    void perIpLimit429WithRetryAfterComesBeforeValidation() throws Exception {
        when(barcodes.lookup(anyString()))
                .thenThrow(new ApiException(HttpStatus.BAD_REQUEST, "invalid_barcode", "That is not a valid barcode. Check the digits."));
        for (int i = 0; i < 3; i++) {
            mvc.perform(get("/api/v1/foods/barcode/1").with(from("10.2.0.8"))).andExpect(status().isBadRequest());
        }
        var res = mvc.perform(get("/api/v1/foods/barcode/1").with(from("10.2.0.8")))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
        ContractSchemas.assertResponse(OP, 429, body(res));
        // Invalid codes counted toward the limit, and the refused request never reached validation.
        verify(barcodes, times(3)).lookup("1");
    }

    @Test
    void signedInRequestsUseTheSameIpScopeNotThePerUserBucket() throws Exception {
        when(barcodes.lookup(CODE)).thenReturn(JSON.readTree(LAYS));
        String token = jwt.issue(UUID.randomUUID().toString()).value();
        // The per-user bucket here holds only 2: three signed-in calls pass, so it was never used for this path.
        for (int i = 0; i < 3; i++) {
            mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.9")).header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk());
        }
        // The fourth is refused by the per-IP scope: signed in or not, one bucket per IP.
        mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.9")).header("Authorization", "Bearer " + token))
                .andExpect(status().isTooManyRequests());
        mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.9")))
                .andExpect(status().isTooManyRequests());
        // Another IP is unaffected.
        mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.10")).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    @Test
    void theBarcodeIsInNoLogLineEvenAtDebug() throws Exception {
        when(barcodes.lookup(CODE)).thenReturn(JSON.readTree(LAYS));
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        Level before = root.getLevel();
        // MockMvc runs a DispatcherServlet subclass that logs under its own name; the real servlet's name is the one
        // application.yml pins, which the assertions below check directly.
        Logger testServlet = (Logger) LoggerFactory.getLogger("org.springframework.test.web.servlet.TestDispatcherServlet");
        for (Class<?> pinned : List.of(org.springframework.web.servlet.DispatcherServlet.class,
                org.springframework.security.web.FilterChainProxy.class,
                org.springframework.security.web.access.intercept.RequestMatcherDelegatingAuthorizationManager.class)) {
            assertThat(((Logger) LoggerFactory.getLogger(pinned)).getEffectiveLevel()).as(pinned.getSimpleName()).isEqualTo(Level.INFO);
        }
        testServlet.setLevel(Level.INFO);
        var lines = new ch.qos.logback.core.read.ListAppender<ILoggingEvent>();
        lines.start();
        root.addAppender(lines);
        root.setLevel(Level.TRACE); // the per-class levels in application.yml still hold the request-line loggers at INFO
        try {
            for (int i = 0; i < 4; i++) { // the 4th is the 429, whose line the security filter writes
                mvc.perform(get("/api/v1/foods/barcode/" + CODE).with(from("10.2.0.11")));
            }
        } finally {
            root.setLevel(before);
            testServlet.setLevel(null);
            root.detachAppender(lines);
        }
        List<String> all = lines.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
        assertThat(all).anyMatch(m -> m.startsWith("Rate limit hit (bucket=barcode-ip, path=/api/v1/foods/barcode/{id})"));
        assertThat(lines.list.stream().filter(e -> !e.getLoggerName().startsWith("org.springframework.test") && !e.getLoggerName().contains("RfcUriParser")).filter(e -> e.getFormattedMessage().contains(CODE)).map(e -> e.getLevel() + " " + e.getLoggerName()).distinct().toList()).isEmpty();
        assertThat(lines.list.stream().map(e -> String.valueOf(e.getThrowableProxy())).toList()).noneMatch(m -> m.contains(CODE));
        verify(barcodes, never()).lookup("other");
    }
}
