package app.plateandbar.api.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.sentry.IScopes;
import io.sentry.RequestDetails;
import io.sentry.Sentry;
import io.sentry.SentryEnvelope;
import io.sentry.SentryEnvelopeItem;
import io.sentry.SentryOptions;
import io.sentry.protocol.User;
import io.sentry.transport.ITransport;
import io.sentry.transport.RateLimiter;
import io.sentry.Hint;
import io.sentry.ITransportFactory;
import io.sentry.spring.boot4.SentryAutoConfiguration;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The SDK is off without a DSN (nothing created, nothing sent) and scrubs end to end with one. */
class SentryWiringTest {

    static final AtomicInteger FACTORIES = new AtomicInteger();
    static final List<String> SENT = new CopyOnWriteArrayList<>();

    @Configuration
    static class Cfg {
        @Bean
        SentryScrubber sentryScrubber() {
            return new SentryScrubber();
        }

        @Bean
        ITransportFactory transportFactory() {
            FACTORIES.incrementAndGet();
            return (options, details) -> new ITransport() {
                @Override
                public void send(SentryEnvelope envelope, Hint hint) throws java.io.IOException {
                    for (SentryEnvelopeItem item : envelope.getItems()) {
                        try {
                            SENT.add(new String(item.getData(), StandardCharsets.UTF_8));
                        } catch (Exception e) {
                            throw new java.io.IOException(e);
                        }
                    }
                }

                @Override
                public boolean isHealthy() {
                    return true;
                }

                @Override
                public void flush(long timeoutMillis) {}

                @Override
                public RateLimiter getRateLimiter() {
                    return null;
                }

                @Override
                public void close() {}

                @Override
                public void close(boolean isRestarting) {}
            };
        }
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(SentryAutoConfiguration.class))
            .withUserConfiguration(Cfg.class);

    @AfterEach
    void reset() {
        Sentry.close();
        SENT.clear();
        FACTORIES.set(0);
    }

    @Test
    void noDsnMeansDisabledAndNothingIsSent() {
        runner.withPropertyValues("sentry.dsn=", "sentry.send-default-pii=false").run(ctx -> {
            Sentry.captureException(new RuntimeException("boom"));
            Sentry.flush(1000);
            assertThat(Sentry.isEnabled()).isFalse();
            assertThat(SENT).isEmpty();
        });
    }

    @Test
    void dsnTurnsItOnAndEverythingSentIsScrubbed() {
        runner.withPropertyValues("sentry.dsn=https://publickey@errors.invalid/1", "sentry.send-default-pii=false")
                .run(ctx -> {
                    assertThat(Sentry.isEnabled()).isTrue();
                    User u = new User();
                    u.setId("abc-user");
                    u.setEmail("jane@example.com");
                    Sentry.setUser(u);
                    Sentry.setTag("food_name", "chicken");
                    Sentry.captureException(new IllegalStateException("ate chicken at 81 kg"));
                    Sentry.flush(2000);
                    assertThat(SENT).isNotEmpty();
                    String all = String.join("\n", SENT);
                    assertThat(all).contains("IllegalStateException")
                            .doesNotContain("chicken", "81 kg", "jane", "example.com", "abc-user", "food_name");
                });
    }
}
