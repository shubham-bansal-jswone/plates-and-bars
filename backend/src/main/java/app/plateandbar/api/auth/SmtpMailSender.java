package app.plateandbar.api.auth;

import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.util.Properties;
import org.springframework.context.annotation.Profile;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

/**
 * Delivers sign-in codes over SMTP (everything except the dev profile). Logs nothing: the code and the address
 * only ever go into the message. Failures are thrown to the caller, which logs the exception class alone.
 */
@Component
@Profile("!dev")
public class SmtpMailSender implements MailSender {

    private static final String SUBJECT = "Your Plate & Bar sign-in code";

    private final JavaMailSenderImpl sender;
    private final String from;

    public SmtpMailSender(MailProperties props) {
        if (props.host().isEmpty() || props.from().isEmpty()) {
            throw new IllegalStateException("SMTP_HOST and SMTP_FROM are required unless the dev profile is active");
        }
        this.sender = new JavaMailSenderImpl();
        sender.setHost(props.host());
        sender.setPort(props.port());
        if (props.username() != null && !props.username().isBlank()) {
            sender.setUsername(props.username());
            sender.setPassword(props.password());
        }
        boolean credentials = sender.getUsername() != null;
        if (credentials && !props.starttls()) {
            throw new IllegalStateException("SMTP_USER and SMTP_PASSWORD need SMTP_STARTTLS=true: credentials are never sent in plaintext");
        }
        Properties p = sender.getJavaMailProperties();
        p.put("mail.smtp.auth", String.valueOf(credentials));
        p.put("mail.smtp.starttls.enable", String.valueOf(props.starttls()));
        p.put("mail.smtp.starttls.required", String.valueOf(props.starttls()));
        p.put("mail.smtp.connectiontimeout", "5000");
        p.put("mail.smtp.timeout", "10000");
        p.put("mail.smtp.writetimeout", "10000");
        this.from = props.from();
    }

    @Override
    public void sendSignInCode(String email, String code, Instant expiresAt) {
        try {
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, "UTF-8");
            helper.setFrom(from);
            helper.setTo(email);
            helper.setSubject(SUBJECT);
            helper.setText("Your Plate & Bar sign-in code is " + code + ".\n\nIt expires at " + expiresAt
                    + ". If you did not ask for it, ignore this message.\n");
            sender.send(message);
        } catch (jakarta.mail.MessagingException | org.springframework.mail.MailException e) {
            // No cause and no original message: both can carry the recipient address.
            throw new org.springframework.mail.MailSendException("SMTP delivery failed (" + e.getClass().getSimpleName() + ")");
        }
    }
}
