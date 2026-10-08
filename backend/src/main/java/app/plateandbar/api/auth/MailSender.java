package app.plateandbar.api.auth;

import java.time.Instant;

/** Sends sign-in codes. The real provider is chosen in a later issue; implementations must never log the code or address. */
public interface MailSender {
    void sendSignInCode(String email, String code, Instant expiresAt);
}
