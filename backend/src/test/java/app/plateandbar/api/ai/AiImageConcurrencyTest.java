package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** The cap on concurrent image decodes (#990): 2 per instance, a 2 s wait, then 503 with Retry-After. */
class AiImageConcurrencyTest {

    @Test
    void theCapIsTwoWithATwoSecondWait() {
        assertThat(AiImages.MAX_CONCURRENT).isEqualTo(2);
        assertThat(AiImages.PERMIT_WAIT_MS).isEqualTo(2_000);
        assertThat(AiImages.PERMITS.availablePermits()).isEqualTo(2);
    }

    @Test
    void neverMoreThanTwoRunAtOnceUnderParallelRequestsAndEveryoneIsServedWhenTheWaitIsLongEnough() throws Exception {
        Semaphore gate = new Semaphore(AiImages.MAX_CONCURRENT, true);
        AtomicInteger now = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();
        int callers = 12;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Integer>> results = new ArrayList<>();
            for (int i = 0; i < callers; i++) {
                int n = i;
                results.add(pool.submit(() -> {
                    go.await();
                    return AiImages.withPermit(gate, 10_000, () -> {
                        peak.accumulateAndGet(now.incrementAndGet(), Math::max);
                        try {
                            Thread.sleep(30);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        } finally {
                            now.decrementAndGet();
                        }
                        return n;
                    });
                }));
            }
            go.countDown();
            for (int i = 0; i < callers; i++) {
                assertThat(results.get(i).get(30, TimeUnit.SECONDS)).isEqualTo(i);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(peak.get()).isEqualTo(2);
        assertThat(gate.availablePermits()).isEqualTo(2);
    }

    @Test
    void aThirdRequestWaitsAtMostTheLimitThenIs503WithRetryAfterAndTakesNoPermit() throws Exception {
        Semaphore gate = new Semaphore(2, true);
        gate.acquire(2);
        long start = System.nanoTime();
        assertThatThrownBy(() -> AiImages.withPermit(gate, 200, () -> "never"))
                .isInstanceOfSatisfying(ImageBusyException.class, e -> {
                    assertThat(e.status().value()).isEqualTo(503);
                    assertThat(e.code()).isEqualTo("unavailable");
                    assertThat(e.retryAfterSeconds()).isEqualTo(AiImages.RETRY_AFTER_SECONDS);
                });
        long ms = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
        assertThat(ms).isBetween(150L, 1_500L);
        assertThat(gate.availablePermits()).as("the refused request holds nothing").isZero();
        gate.release(2);
        assertThat(AiImages.withPermit(gate, 200, () -> "ok")).isEqualTo("ok");
    }

    @Test
    void permitsAreReleasedWhenTheWorkThrowsWhatEverItThrows() {
        Semaphore gate = new Semaphore(2, true);
        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> AiImages.withPermit(gate, 200, () -> {
                throw new IllegalStateException("boom");
            })).isInstanceOf(IllegalStateException.class);
            assertThatThrownBy(() -> AiImages.withPermit(gate, 200, () -> {
                throw new OutOfMemoryError("pixels");
            })).isInstanceOf(OutOfMemoryError.class);
        }
        assertThat(gate.availablePermits()).isEqualTo(2);
    }

    @Test
    void aWaitThatIsInterruptedIs503AndKeepsTheInterruptFlag() throws Exception {
        Semaphore gate = new Semaphore(1, true);
        gate.acquire();
        Thread.currentThread().interrupt();
        try {
            assertThatThrownBy(() -> AiImages.withPermit(gate, 5_000, () -> "never")).isInstanceOf(ImageBusyException.class);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
        assertThat(gate.availablePermits()).isZero();
    }

    @Test
    void aBadImageReleasesItsPermitAndAFullGateRefusesARealReencode() throws Exception {
        ObjectMapper json = new ObjectMapper();
        // A PNG header that claims 8x8 but has no pixel data: passes the header checks, fails inside the permit.
        ObjectNode ok = json.createObjectNode().put("media_type", "image/png").put("data", AiImagesTest.dataOf(AiImagesTest.VECTORS.path("cases").get(0)));
        byte[] png = java.util.Base64.getDecoder().decode(ok.path("data").asString());
        byte[] cut = java.util.Arrays.copyOf(png, 40);
        ObjectNode broken = json.createObjectNode().put("media_type", "image/png").put("data", java.util.Base64.getEncoder().encodeToString(cut));
        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> AiImages.reencode(broken, "image", AiImages.Kind.PHOTO)).isInstanceOf(app.plateandbar.api.common.ApiException.class);
        }
        assertThat(AiImages.PERMITS.availablePermits()).isEqualTo(2);

        AiImages.PERMITS.acquire(2);
        try {
            long start = System.nanoTime();
            assertThatThrownBy(() -> AiImages.reencode(ok, "image", AiImages.Kind.PHOTO)).isInstanceOf(ImageBusyException.class);
            assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)).isBetween(1_800L, 5_000L);
        } finally {
            AiImages.PERMITS.release(2);
        }
        assertThat(AiImages.reencode(ok, "image", AiImages.Kind.PHOTO)).isNotEmpty();
        assertThat(AiImages.PERMITS.availablePermits()).isEqualTo(2);
    }
}
