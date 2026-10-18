package app.plateandbar.api.observability;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.common.ApiException;
import io.sentry.Breadcrumb;
import io.sentry.Hint;
import io.sentry.JsonSerializer;
import io.sentry.SentryEvent;
import io.sentry.SentryOptions;
import io.sentry.protocol.Message;
import io.sentry.protocol.Request;
import io.sentry.protocol.SentryException;
import io.sentry.protocol.User;
import java.io.StringWriter;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/** Worst-case events for a sync, an auth and an AI request; asserts on the full JSON the SDK would send. */
class SentryScrubberTest {

    private final SentryScrubber scrubber = new SentryScrubber();

    private static String json(SentryEvent e) throws Exception {
        StringWriter w = new StringWriter();
        new JsonSerializer(new SentryOptions()).serialize(e, w);
        return w.toString();
    }

    private SentryEvent event(String method, String url, String query, String body, String exceptionMessage) {
        SentryEvent e = new SentryEvent(new IllegalStateException(exceptionMessage));
        SentryException ex = new SentryException();
        ex.setType("IllegalStateException");
        ex.setValue(exceptionMessage);
        e.setExceptions(List.of(ex));
        e.setMessage(new Message());
        e.getMessage().setFormatted(exceptionMessage);
        Request r = new Request();
        r.setMethod(method);
        r.setUrl(url);
        r.setQueryString(query);
        r.setData(body);
        r.setCookies("refresh=SECRETCOOKIE");
        r.setHeaders(Map.of(
                "Authorization", "Bearer SECRETJWT",
                "Cookie", "refresh=SECRETCOOKIE",
                "X-Forwarded-For", "203.0.113.9",
                "User-Agent", "PlateAndBar/1.0",
                "Content-Type", "application/json"));
        e.setRequest(r);
        User u = new User();
        u.setId("11111111-2222-3333-4444-555555555555");
        u.setEmail("jane@example.com");
        u.setUsername("jane");
        u.setIpAddress("203.0.113.9");
        e.setUser(u);
        e.addBreadcrumb(new Breadcrumb("ate chicken curry 640 kcal"));
        e.setTag("food_name", "chicken");
        e.setTag("route", "/sync");
        e.setExtra("weight_kg", 81.2);
        e.setExtra("healthAnswer", "knee injury");
        e.setExtra("refreshToken", "SECRETREFRESH");
        e.setExtra("attempt", 2);
        return e;
    }

    private void assertClean(String out, String... forbidden) {
        for (String f : forbidden) {
            assertThat(out).as("must not contain %s", f).doesNotContain(f);
        }
        assertThat(out)
                .doesNotContain("SECRET", "jane", "example.com", "203.0.113.9", "11111111-2222")
                .doesNotContain("Authorization", "Cookie", "X-Forwarded-For", "food_name", "weight_kg")
                .doesNotContain("healthAnswer", "refreshToken", "breadcrumbs", "queryString", "\"data\"", "\"cookies\"")
                .contains("PlateAndBar/1.0", "application/json", "IllegalStateException", "\"attempt\":2", "\"route\"");
    }

    @Test
    void syncErrorKeepsOnlyTheSafeParts() throws Exception {
        SentryEvent e = event("POST", "http://api/api/v1/sync", "cursor=abc&food=rice",
                "{\"table\":\"food_entries\",\"name\":\"chicken curry\",\"weight_kg\":81.2}",
                "Duplicate entry 'chicken curry' for key food_entries.PRIMARY");
        SentryEvent out = scrubber.execute(e, new Hint());
        String s = json(out);
        assertClean(s, "chicken", "curry", "cursor", "food=rice", "81.2", "640 kcal", "knee");
        assertThat(s).contains("\"url\":\"http://api/api/v1/sync\"", "\"method\":\"POST\"");
        assertThat(out.getUser().getId()).isEqualTo(SentryScrubber.opaque("11111111-2222-3333-4444-555555555555"))
                .hasSize(16).doesNotContain("-");
        assertThat(out.getUser().getEmail()).isNull();
    }

    @Test
    void authErrorDropsCodesTokensAndEmail() throws Exception {
        SentryEvent e = event("POST", "http://api/api/v1/auth/email/verify?code=123456", "code=123456&token=SECRETQ",
                "{\"email\":\"jane@example.com\",\"code\":\"123456\"}",
                "Bad token SECRETJWT for jane@example.com");
        String s = json(scrubber.execute(e, new Hint()));
        assertClean(s, "123456", "code=");
        assertThat(s).contains("\"url\":\"http://api/api/v1/auth/email/verify\"");
    }

    @Test
    void aiErrorDropsTheTextAndMasksUuidPaths() throws Exception {
        SentryEvent e = event("POST", "http://api/api/v1/ai/describe-meal/22222222-2222-2222-2222-222222222222",
                "x=1", "{\"text\":\"two eggs and toast, I weigh 82 kg and have diabetes\"}",
                "Provider said: two eggs and toast");
        String s = json(scrubber.execute(e, new Hint()));
        assertClean(s, "eggs", "toast", "82 kg", "diabetes", "22222222-2222");
        assertThat(s).contains("describe-meal/{id}");
    }

    @Test
    void expectedClientErrorsAreDropped() {
        SentryEvent e = new SentryEvent(new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "bad"));
        assertThat(scrubber.execute(e, new Hint())).isNull();
        SentryEvent s5 = new SentryEvent(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "unavailable", "down"));
        assertThat(scrubber.execute(s5, new Hint())).isNotNull();
    }

    @Test
    void aBarcodeUrlIsRewrittenToACodePlaceholder() throws Exception {
        SentryEvent e = event("GET", "https://api.example.com/api/v1/foods/barcode/8901491101837", null, null, "boom");
        String out = json(scrubber.execute(e, new Hint()));
        assertThat(out).doesNotContain("8901491101837").contains("/api/v1/foods/barcode/{code}");
    }

    @Test
    void eventWithoutRequestOrUserIsFine() throws Exception {
        SentryEvent e = new SentryEvent(new RuntimeException("x"));
        assertThat(json(scrubber.execute(e, new Hint()))).doesNotContain("\"user\"", "\"request\"");
    }
}
