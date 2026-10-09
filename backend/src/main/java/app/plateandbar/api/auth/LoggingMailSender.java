package app.plateandbar.api.auth;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Dev-profile stand-in: records only that a code was issued, never the code or the address. */
@Component
@Profile("dev")
public class LoggingMailSender implements MailSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingMailSender.class);

    @Override
    public void sendSignInCode(String email, String code, Instant expiresAt) {
        log.info("Sign-in code issued, expires at {}", expiresAt);
    }
}
