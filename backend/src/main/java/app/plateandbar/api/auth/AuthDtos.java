package app.plateandbar.api.auth;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** Request and response bodies for /auth/*, named and shaped exactly as the contract schemas. */
final class AuthDtos {
    private AuthDtos() {}

    record GoogleSignInRequest(@JsonProperty("id_token") @NotBlank String idToken) {
        @Override
        public String toString() {
            return "GoogleSignInRequest[redacted]";
        }
    }

    record EmailStartRequest(@NotBlank @Email @Size(max = 254) String email) {
        EmailStartRequest {
            email = email == null ? null : email.trim();
        }

        @Override
        public String toString() {
            return "EmailStartRequest[redacted]";
        }
    }

    record EmailStartResponse(
            @JsonProperty("code_expires_at") Instant codeExpiresAt,
            @JsonProperty("resend_after_seconds") int resendAfterSeconds) {}

    record EmailVerifyRequest(
            @NotBlank @Email @Size(max = 254) String email, @NotBlank @Pattern(regexp = "^[0-9]{6}$") String code) {
        EmailVerifyRequest {
            email = email == null ? null : email.trim();
        }

        @Override
        public String toString() {
            return "EmailVerifyRequest[redacted]";
        }
    }

    record RefreshRequest(@JsonProperty("refresh_token") @NotBlank String refreshToken) {
        @Override
        public String toString() {
            return "RefreshRequest[redacted]";
        }
    }

    record UserDto(String id, String email, @JsonProperty("created_at") Instant createdAt) {
        @Override
        public String toString() {
            return "UserDto[redacted]";
        }
    }

    record TokenPair(
            @JsonProperty("token_type") String tokenType,
            @JsonProperty("access_token") String accessToken,
            @JsonProperty("access_token_expires_at") Instant accessTokenExpiresAt,
            @JsonProperty("refresh_token") String refreshToken,
            @JsonProperty("refresh_token_expires_at") Instant refreshTokenExpiresAt,
            UserDto user,
            @JsonProperty("new_user") boolean newUser) {
        // Spring logs bodies at DEBUG via toString; never let tokens through.
        @Override
        public String toString() {
            return "TokenPair[redacted]";
        }
    }
}
