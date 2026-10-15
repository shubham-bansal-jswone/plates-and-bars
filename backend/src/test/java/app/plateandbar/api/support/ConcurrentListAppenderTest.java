package app.plateandbar.api.support;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** Regression for #466: iterating the captured logs while another thread appends must not throw. */
class ConcurrentListAppenderTest {

    @Test
    void iteratingWhileAnotherThreadAppendsDoesNotThrow() throws Exception {
        LoggerContext ctx = new LoggerContext();
        Logger log = ctx.getLogger("t");
        ConcurrentListAppender appender = new ConcurrentListAppender();
        appender.setContext(ctx);
        appender.start();
        log.addAppender(appender);

        AtomicBoolean stop = new AtomicBoolean();
        Thread writer = new Thread(() -> {
            while (!stop.get() && appender.list.size() < 5_000) {
                log.info("x");
            }
        });
        writer.start();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        try {
            while (writer.isAlive()) {
                for (var e : appender.list) {
                    e.getFormattedMessage();
                }
            }
        } catch (Throwable t) {
            failure.set(t);
        } finally {
            stop.set(true);
            writer.join();
        }
        assertThat(failure.get()).isNull();
    }
}
