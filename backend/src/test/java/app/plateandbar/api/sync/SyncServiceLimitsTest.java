package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.junit.jupiter.api.Test;

class SyncServiceLimitsTest {

    private static SyncService with(int keep, int days) {
        return new SyncService(mock(SyncRepository.class), Clock.systemUTC(), new ObjectMapper(), keep, days);
    }

    @Test
    void conflictLogLimitsBelowOneFailStartup() {
        assertThatThrownBy(() -> with(0, 90)).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("conflict-log-max-per-user");
        assertThatThrownBy(() -> with(1000, 0)).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("conflict-log-retention-days");
        assertThatThrownBy(() -> with(-1, -1)).isInstanceOf(IllegalArgumentException.class);
        assertThatCode(() -> with(1, 1)).doesNotThrowAnyException();
    }
}
