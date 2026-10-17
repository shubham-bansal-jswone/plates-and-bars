package app.plateandbar.api.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ApiExceptionHandler;
import io.sentry.Hint;
import io.sentry.ITransportFactory;
import io.sentry.Sentry;
import io.sentry.SentryEnvelope;
import io.sentry.SentryEnvelopeItem;
import io.sentry.spring.boot4.SentryAutoConfiguration;
import io.sentry.transport.ITransport;
import io.sentry.transport.RateLimiter;
import jakarta.servlet.Filter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Request handling reaches Sentry (real 500s only, scrubbed) and never sends a transaction. */
class SentryRequestHandlingTest {

    static final List<String> SENT = new CopyOnWriteArrayList<>();

    @RestController
    static class Boom {
        @GetMapping("/boom")
        String boom() {
            throw new IllegalStateException("ate chicken at 81 kg");
        }

        @GetMapping("/missing")
        String missing() {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "no chicken");
        }

        @GetMapping("/ok")
        String ok() {
            return "ok";
        }
    }

    @Configuration
    static class Cfg {
        @Bean
        SentryScrubber sentryScrubber() {
            return new SentryScrubber();
        }

        @Bean
        ApiExceptionHandler apiExceptionHandler() {
            return new ApiExceptionHandler();
        }

        @Bean
        Boom boom() {
            return new Boom();
        }

        @Bean
        ITransportFactory transportFactory() {
            return (options, details) -> new ITransport() {
                @Override
                public void send(SentryEnvelope envelope, Hint hint) throws java.io.IOException {
                    for (SentryEnvelopeItem item : envelope.getItems()) {
                        try {
                            String type = item.getHeader().getType().getItemType();
                            SENT.add(type + " " + new String(item.getData(), StandardCharsets.UTF_8));
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

    private final WebApplicationContextRunner runner = new WebApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(
                    SentryAutoConfiguration.class,
                    org.springframework.boot.webmvc.autoconfigure.WebMvcAutoConfiguration.class))
            .withUserConfiguration(Cfg.class)
            .withPropertyValues(
                    "sentry.dsn=https://publickey@errors.invalid/1",
                    "sentry.send-default-pii=false",
                    "sentry.max-breadcrumbs=0");

    @AfterEach
    void reset() {
        Sentry.close();
        SENT.clear();
    }

    private static MockMvc mvc(org.springframework.web.context.WebApplicationContext ctx) {
        // The SDK registers its filters through FilterRegistrationBean, as the servlet container would.
        Filter[] filters = ctx.getBeansOfType(org.springframework.boot.web.servlet.FilterRegistrationBean.class)
                .values().stream().map(r -> (Filter) r.getFilter()).toArray(Filter[]::new);
        return MockMvcBuilders.webAppContextSetup(ctx).addFilters(filters).build();
    }

    @Test
    void aRealServerErrorReachesSentryOnceAndScrubbed() {
        runner.run(ctx -> {
            mvc(ctx).perform(get("/boom").header("Authorization", "Bearer secret-token").param("q", "chicken"))
                    .andExpect(status().isInternalServerError());
            Sentry.flush(2000);
            List<String> events = SENT.stream().filter(s -> s.startsWith("event ")).toList();
            assertThat(events).hasSize(1);
            assertThat(events.get(0))
                    .contains("IllegalStateException")
                    .doesNotContain("chicken", "81 kg", "secret-token", "Bearer");
        });
    }

    @Test
    void clientErrorsAreNotReported() {
        runner.run(ctx -> {
            mvc(ctx).perform(get("/missing")).andExpect(status().isNotFound());
            mvc(ctx).perform(get("/no-such-path")).andExpect(status().isNotFound());
            Sentry.flush(2000);
            assertThat(SENT).isEmpty();
        });
    }

    @Test
    void aSentryTraceHeaderCannotForceATransaction() {
        // Even with tracing registered (the old rate of 0.0), the transaction filter drops it.
        runner.withPropertyValues("sentry.traces-sample-rate=0.0").run(ctx -> {
            mvc(ctx).perform(get("/ok").header("sentry-trace", "0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-1"))
                    .andExpect(status().isOk());
            Sentry.flush(2000);
            assertThat(SENT).noneMatch(s -> s.startsWith("transaction"));
            assertThat(SENT).isEmpty();
        });
    }
}
