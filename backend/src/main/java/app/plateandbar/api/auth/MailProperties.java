package app.plateandbar.api.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** SMTP settings, from the environment only. Host and from are required outside the dev profile. */
@ConfigurationProperties(prefix = "app.mail")
public record MailProperties(String host, Integer port, String username, String password, String from, Boolean starttls) {
    public MailProperties {
        host = host == null ? "" : host.trim();
        from = from == null ? "" : from.trim();
        port = port == null ? 587 : port;
        starttls = starttls == null || starttls;
    }
}
