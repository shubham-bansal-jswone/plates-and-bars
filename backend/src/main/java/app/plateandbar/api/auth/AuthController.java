package app.plateandbar.api.auth;

import app.plateandbar.api.auth.AuthDtos.*;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import tools.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /api/v1/auth/*}. On the four endpoints that honour {@code X-Auth-Transport: cookie} (ADR 006) the refresh token
 * travels in the {@code __Secure-pb_refresh} cookie instead of the body; see {@link CookieMode}. The Origin check of
 * cookie mode runs earlier, in {@link CookieModeOriginFilter}.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/google")
    public ResponseEntity<TokenPair> google(@Valid @RequestBody GoogleSignInRequest req, HttpServletRequest http) {
        return tokens(auth.signInWithGoogle(req.idToken()), CookieMode.requested(http));
    }

    @PostMapping("/email/start")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public EmailStartResponse emailStart(@Valid @RequestBody EmailStartRequest req) {
        return auth.startEmailSignIn(req.email());
    }

    @PostMapping("/email/verify")
    public ResponseEntity<TokenPair> emailVerify(@Valid @RequestBody EmailVerifyRequest req, HttpServletRequest http) {
        return tokens(auth.verifyEmailSignIn(req.email(), req.code()), CookieMode.requested(http));
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenPair> refresh(
            @RequestBody TokenBody wrapped, HttpServletRequest http, HttpServletResponse response) {
        boolean cookie = CookieMode.requested(http);
        String presented = bodyChecked(wrapped == null ? null : wrapped.tree(), cookie);
        try {
            if (cookie) {
                // No cookie is the same refusal as an unknown token, and clears it like every refresh 401.
                presented = CookieMode.token(http).orElseThrow(ApiException::sessionEnded);
            }
            return tokens(auth.refresh(presented), cookie);
        } catch (ApiException e) {
            if (cookie && e.status() == HttpStatus.UNAUTHORIZED) {
                response.addHeader(HttpHeaders.SET_COOKIE, CookieMode.clear());
            }
            throw e; // other errors (503 and so on) leave the cookie as it is
        }
    }

    /** Ends the session of the presented token. Always 204, so a retry is safe; clears the cookie in cookie mode. */
    @PostMapping("/refresh/revoke")
    public ResponseEntity<Void> revoke(@RequestBody TokenBody wrapped, HttpServletRequest http) {
        boolean cookie = CookieMode.requested(http);
        String presented = bodyChecked(wrapped == null ? null : wrapped.tree(), cookie);
        if (cookie) {
            presented = CookieMode.token(http).orElse(null);
        }
        if (presented != null) {
            auth.revokeSession(presented);
        }
        ResponseEntity.HeadersBuilder<?> done = ResponseEntity.noContent();
        if (cookie) {
            done.header(HttpHeaders.SET_COOKIE, CookieMode.clear());
        }
        return done.build();
    }

    /**
     * Body mode: the body's {@code refresh_token}, never blank (a number or boolean is read as its text, as before).
     * Cookie mode: null, after refusing a body that carries the field at all, whatever its value (400
     * {@code invalid_request}). The body is read as a tree because "present" must not depend on the value, which a
     * typed field cannot tell (absent and null look the same). Either way it must be a JSON object.
     */
    private static String bodyChecked(JsonNode body, boolean cookie) {
        boolean valid = body != null && body.isObject();
        String token = null;
        if (valid && body.has("refresh_token")) {
            JsonNode t = body.get("refresh_token");
            token = t.isValueNode() && !t.isNull() ? t.asString() : "";
        }
        if (!valid || (cookie ? token != null : token == null || token.isBlank())) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "invalid_request",
                    "The request is not valid.",
                    List.of(new ErrorResponse.Detail("refresh_token", "invalid")));
        }
        return token;
    }

    /** Cookie mode sets the cookie and blanks the body's token; body mode answers as before. */
    private static ResponseEntity<TokenPair> tokens(TokenPair pair, boolean cookie) {
        if (!cookie) {
            return ResponseEntity.ok(pair);
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, CookieMode.set(pair.refreshToken(), AuthService.REFRESH_TTL.toSeconds()))
                .body(pair.withoutRefreshToken());
    }
}
