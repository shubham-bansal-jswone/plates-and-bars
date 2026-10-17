package app.plateandbar.api.auth;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.AuthDtos.EmailStartResponse;
import app.plateandbar.api.auth.AuthDtos.TokenPair;
import app.plateandbar.api.auth.AuthDtos.UserDto;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.StrictJsonVectors;
import app.plateandbar.api.support.WebMvcAuthSlice;
import java.time.Instant;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(AuthController.class)
@WebMvcAuthSlice
// The strict-JSON vectors send more email/start requests than its 10 per hour per IP.
@org.springframework.test.context.TestPropertySource(properties = "app.rate-limit.email-start-per-ip.capacity=100000")
class AuthControllerTest {

    @Autowired MockMvc mvc;
    @MockitoBean AuthService auth;

    private static final TokenPair PAIR = new TokenPair(
            "Bearer",
            "access.jwt.value",
            Instant.parse("2026-10-08T06:45:00Z"),
            "rt_abc",
            Instant.parse("2027-01-06T06:30:00Z"),
            new UserDto("11111111-1111-1111-1111-111111111111", "asha@example.com", Instant.parse("2026-10-08T06:30:00Z")),
            true);

    private static MockHttpServletRequestBuilder json(String path, String body) {
        return post(path).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    @Test
    void googleReturnsTokenPairInContractShapeWithoutBearerToken() throws Exception {
        when(auth.signInWithGoogle("g-token")).thenReturn(PAIR);
        mvc.perform(json("/api/v1/auth/google", "{\"id_token\":\"g-token\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token_type").value("Bearer"))
                .andExpect(jsonPath("$.access_token").value("access.jwt.value"))
                .andExpect(jsonPath("$.access_token_expires_at").value("2026-10-08T06:45:00Z"))
                .andExpect(jsonPath("$.refresh_token").value("rt_abc"))
                .andExpect(jsonPath("$.refresh_token_expires_at").value("2027-01-06T06:30:00Z"))
                .andExpect(jsonPath("$.user.id").value("11111111-1111-1111-1111-111111111111"))
                .andExpect(jsonPath("$.user.email").value("asha@example.com"))
                .andExpect(jsonPath("$.user.created_at").value("2026-10-08T06:30:00Z"))
                .andExpect(jsonPath("$.new_user").value(true));
    }

    @Test
    void googleRefusalIs401Unauthorized() throws Exception {
        when(auth.signInWithGoogle(any())).thenThrow(ApiException.unauthorized());
        mvc.perform(json("/api/v1/auth/google", "{\"id_token\":\"x\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"));
    }

    @Test
    void googleMissingOrBlankTokenIs400() throws Exception {
        mvc.perform(json("/api/v1/auth/google", "{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"));
        mvc.perform(json("/api/v1/auth/google", "{\"id_token\":\"  \"}")).andExpect(status().isBadRequest());
        mvc.perform(json("/api/v1/auth/google", "not json")).andExpect(status().isBadRequest());
        verifyNoInteractions(auth);
    }

    /** Contract 0.1.18 wire conventions (#720): the shared vectors, on the /auth/* bodies they name. */
    @ParameterizedTest(name = "refused: {0}")
    @MethodSource("refusedVectors")
    void strictJsonVectorsAreRefused(StrictJsonVectors.Vector v) throws Exception {
        mvc.perform(json("/api/v1" + v.path(), v.body()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(content().string(not(containsString("asha@"))))
                .andExpect(content().string(not(containsString("rt_9f2c"))));
        verifyNoInteractions(auth);
    }

    static Stream<StrictJsonVectors.Vector> refusedVectors() {
        return Stream.concat(
                StrictJsonVectors.mustRefuse("/auth/email/start").stream(),
                StrictJsonVectors.mustRefuse("/auth/refresh").stream());
    }

    @ParameterizedTest(name = "accepted: {0}")
    @MethodSource("acceptedVectors")
    void strictJsonVectorsThatAreValidAreAccepted(StrictJsonVectors.Vector v) throws Exception {
        when(auth.startEmailSignIn("asha@example.com"))
                .thenReturn(new EmailStartResponse(Instant.parse("2026-10-08T06:40:00Z"), 60));
        mvc.perform(json("/api/v1" + v.path(), v.body())).andExpect(status().isAccepted());
    }

    static Stream<StrictJsonVectors.Vector> acceptedVectors() {
        return StrictJsonVectors.mustAccept("/auth/email/start").stream();
    }

    /** The revoke endpoint reads the same TokenBody as refresh, so it is as strict. */
    @Test
    void revokeRefusesTrailingContentAndDuplicateKeysWithoutRevoking() throws Exception {
        for (String bad : new String[] {"{\"refresh_token\":\"rt_abc\"} junk",
                "{\"refresh_token\":\"rt_abc\",\"refresh_token\":\"rt_def\"}"}) {
            mvc.perform(json("/api/v1/auth/refresh/revoke", bad))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("invalid_request"))
                    .andExpect(content().string(not(containsString("rt_"))));
        }
        verifyNoInteractions(auth);
    }

    /** The nesting limit stays 1000 (Jackson 3 defaults to 500): 1000 deep parses, 1001 is refused (#81, #720). */
    @Test
    void nestingIsLimitedTo1000() throws Exception {
        int max = StrictJsonVectors.maxNestingDepth();
        when(auth.startEmailSignIn("asha@example.com"))
                .thenReturn(new EmailStartResponse(Instant.parse("2026-10-08T06:40:00Z"), 60));
        // The object is level 1, the array chain the rest.
        String ok = "{\"email\":\"asha@example.com\",\"x\":" + "[".repeat(max - 1) + "]".repeat(max - 1) + "}";
        String deep = "{\"email\":\"asha@example.com\",\"x\":" + "[".repeat(max) + "]".repeat(max) + "}";
        mvc.perform(json("/api/v1/auth/email/start", ok)).andExpect(status().isAccepted());
        mvc.perform(json("/api/v1/auth/email/start", deep)).andExpect(status().isBadRequest());
    }

    @Test
    void emailStartIs202WithExpiryAndResend() throws Exception {
        when(auth.startEmailSignIn("asha@example.com"))
                .thenReturn(new EmailStartResponse(Instant.parse("2026-10-08T06:40:00Z"), 60));
        mvc.perform(json("/api/v1/auth/email/start", "{\"email\":\"  asha@example.com \"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.code_expires_at").value("2026-10-08T06:40:00Z"))
                .andExpect(jsonPath("$.resend_after_seconds").value(60));
        verify(auth).startEmailSignIn("asha@example.com");
    }

    @Test
    void emailStartMalformedAddressIs400() throws Exception {
        for (String body : new String[] {"{}", "{\"email\":\"\"}", "{\"email\":\"nope\"}", "{\"email\":\"a b@c.com\"}"}) {
            mvc.perform(json("/api/v1/auth/email/start", body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("invalid_request"));
        }
        String longEmail = "a".repeat(250) + "@b.com";
        mvc.perform(json("/api/v1/auth/email/start", "{\"email\":\"" + longEmail + "\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(auth);
    }

    @Test
    void emailVerifyReturnsTokenPair() throws Exception {
        when(auth.verifyEmailSignIn("asha@example.com", "482913")).thenReturn(PAIR);
        mvc.perform(json("/api/v1/auth/email/verify", "{\"email\":\"asha@example.com\",\"code\":\"482913\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.new_user").value(true));
    }

    @Test
    void emailVerifyWrongCodeIs401InvalidCode() throws Exception {
        when(auth.verifyEmailSignIn(any(), any())).thenThrow(ApiException.invalidCode());
        mvc.perform(json("/api/v1/auth/email/verify", "{\"email\":\"asha@example.com\",\"code\":\"000000\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("invalid_code"))
                .andExpect(jsonPath("$.message").exists());
    }

    @Test
    void emailVerifyBadCodeFormatIs400() throws Exception {
        for (String code : new String[] {"12345", "1234567", "12345a", "", "123 56"}) {
            mvc.perform(json("/api/v1/auth/email/verify", "{\"email\":\"asha@example.com\",\"code\":\"" + code + "\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("invalid_request"));
        }
        mvc.perform(json("/api/v1/auth/email/verify", "{\"email\":\"asha@example.com\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(auth);
    }

    @Test
    void refreshReturnsTokenPair() throws Exception {
        when(auth.refresh("rt_old")).thenReturn(PAIR);
        mvc.perform(json("/api/v1/auth/refresh", "{\"refresh_token\":\"rt_old\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refresh_token").value("rt_abc"));
    }

    @Test
    void refreshRejectedIs401UnauthorizedAndMissingTokenIs400() throws Exception {
        when(auth.refresh(any())).thenThrow(ApiException.sessionEnded());
        mvc.perform(json("/api/v1/auth/refresh", "{\"refresh_token\":\"rt_bad\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"));
        mvc.perform(json("/api/v1/auth/refresh", "{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"));
    }

    @Test
    void refreshThatCannotCompleteIs503Unavailable() throws Exception {
        when(auth.refresh(any()))
                .thenThrow(new app.plateandbar.api.common.ServiceUnavailableException(
                        new org.springframework.dao.CannotAcquireLockException("lock")));
        mvc.perform(json("/api/v1/auth/refresh", "{\"refresh_token\":\"rt_old\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("unavailable"));
    }
}
