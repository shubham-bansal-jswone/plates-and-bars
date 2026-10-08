package app.plateandbar.api.auth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.AuthDtos.EmailStartResponse;
import app.plateandbar.api.auth.AuthDtos.TokenPair;
import app.plateandbar.api.auth.AuthDtos.UserDto;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.WebMvcAuthSlice;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(AuthController.class)
@WebMvcAuthSlice
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
}
