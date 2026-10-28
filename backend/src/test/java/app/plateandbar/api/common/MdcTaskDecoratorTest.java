package app.plateandbar.api.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

class MdcTaskDecoratorTest {

    private final ThreadPoolTaskExecutor pool = new ThreadPoolTaskExecutor();

    MdcTaskDecoratorTest() {
        pool.setCorePoolSize(1);
        pool.setMaxPoolSize(1); // one worker thread, so a leak would show in the next task
        pool.setTaskDecorator(new MdcTaskDecorator());
        pool.initialize();
    }

    @AfterEach
    void tearDown() {
        pool.shutdown();
        MDC.clear();
    }

    private String idSeenOnWorker() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>("unset");
        pool.submit(() -> seen.set(MDC.get(RequestIdFilter.MDC_KEY))).get();
        return seen.get();
    }

    @Test
    void theWorkerSeesTheCallersRequestId() throws Exception {
        MDC.put(RequestIdFilter.MDC_KEY, "req-1");
        assertThat(idSeenOnWorker()).isEqualTo("req-1");
    }

    @Test
    void theWorkerMdcIsClearedAfterTheTask() throws Exception {
        MDC.put(RequestIdFilter.MDC_KEY, "req-1");
        idSeenOnWorker();
        MDC.remove(RequestIdFilter.MDC_KEY); // next caller has no id
        assertThat(idSeenOnWorker()).isNull();
        AtomicReference<String> after = new AtomicReference<>("unset");
        pool.submit(() -> after.set(MDC.get(RequestIdFilter.MDC_KEY))).get();
        assertThat(after.get()).isNull();
    }

    @Test
    void twoCallersDoNotShareAnId() throws Exception {
        MDC.put(RequestIdFilter.MDC_KEY, "req-a");
        assertThat(idSeenOnWorker()).isEqualTo("req-a");
        MDC.put(RequestIdFilter.MDC_KEY, "req-b");
        assertThat(idSeenOnWorker()).isEqualTo("req-b");
    }

    @Test
    void aFailingTaskStillClearsTheWorker() throws Exception {
        MDC.put(RequestIdFilter.MDC_KEY, "req-1");
        try {
            pool.submit(() -> {
                throw new IllegalStateException("boom");
            }).get();
        } catch (java.util.concurrent.ExecutionException expected) {
            // the task failed on purpose
        }
        MDC.clear();
        AtomicReference<java.util.Map<String, String>> ctx = new AtomicReference<>();
        pool.submit(() -> ctx.set(MDC.getCopyOfContextMap())).get();
        assertThat(ctx.get()).isNullOrEmpty();
    }

    @Test
    void theCallersOwnContextComesBackAfterANormalTask() {
        MDC.put("outer", "o1");
        Runnable decorated;
        try {
            MDC.put(RequestIdFilter.MDC_KEY, "inner");
            decorated = new MdcTaskDecorator().decorate(() -> MDC.put("extra", "x"));
        } finally {
            MDC.clear();
        }
        MDC.put("outer", "o1"); // the thread that runs the task has its own context
        decorated.run();
        assertThat(MDC.getCopyOfContextMap()).containsExactly(java.util.Map.entry("outer", "o1"));
    }

    @Test
    void theCallersOwnContextComesBackAfterAThrowingTask() {
        MDC.put(RequestIdFilter.MDC_KEY, "inner");
        Runnable decorated = new MdcTaskDecorator().decorate(() -> {
            throw new IllegalStateException("boom");
        });
        MDC.clear();
        MDC.put("outer", "o1");
        org.assertj.core.api.Assertions.assertThatThrownBy(decorated::run).isInstanceOf(IllegalStateException.class);
        assertThat(MDC.getCopyOfContextMap()).containsExactly(java.util.Map.entry("outer", "o1"));
    }

    @Test
    void anEmptyOuterContextIsEmptyAgainAfterTheTask() {
        MDC.put(RequestIdFilter.MDC_KEY, "inner");
        Runnable decorated = new MdcTaskDecorator().decorate(() -> assertThat(MDC.get(RequestIdFilter.MDC_KEY)).isEqualTo("inner"));
        MDC.clear();
        decorated.run();
        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }
}
