package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.ServerSetupTest;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/** Real SMTP conversation against an in-process GreenMail server. */
class SmtpMailSenderTest {

    @RegisterExtension
    static final GreenMailExtension SMTP = new GreenMailExtension(ServerSetupTest.SMTP);

    private SmtpMailSender sender(String host, int port) {
        return new SmtpMailSender(new MailProperties(host, port, null, null, "noreply@example.invalid", false));
    }

    @Test
    void deliversTheCodeToTheAddress() throws Exception {
        sender("localhost", SMTP.getSmtp().getPort())
                .sendSignInCode("ada@example.com", "123456", Instant.parse("2026-10-09T10:00:00Z"));

        MimeMessage[] received = SMTP.getReceivedMessages();
        assertThat(received).hasSize(1);
        assertThat(received[0].getAllRecipients()[0].toString()).isEqualTo("ada@example.com");
        assertThat(received[0].getFrom()[0].toString()).isEqualTo("noreply@example.invalid");
        assertThat(received[0].getSubject()).isEqualTo("Your Plate & Bar sign-in code");
        assertThat((String) received[0].getContent()).contains("123456").contains("2026-10-09T10:00:00Z");
    }

    @Test
    void unreachableServerThrowsWithoutLeakingTheCodeOrAddress() {
        assertThatThrownBy(() -> sender("localhost", 1).sendSignInCode("ada@example.com", "654321", Instant.now()))
                .isInstanceOf(RuntimeException.class)
                .satisfies(e -> {
                    // The caller logs only the class name, but the message must not carry the code either.
                    assertThat(String.valueOf(e.getMessage())).doesNotContain("654321");
                });
    }

    @Test
    void refusesToStartWithoutHostOrFrom() {
        assertThatThrownBy(() -> new SmtpMailSender(new MailProperties("", null, null, null, "a@example.invalid", null)))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new SmtpMailSender(new MailProperties("localhost", null, null, null, "", null)))
                .isInstanceOf(IllegalStateException.class);
    }
}
