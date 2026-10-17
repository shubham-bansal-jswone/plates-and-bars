package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import tools.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.junit.jupiter.api.Test;

class SyncServiceLimitsTest {

    private static SyncService with(int keep, int days) {
        return new SyncService(mock(SyncRepository.class), Clock.systemUTC(), new ObjectMapper(), keep, days, "");
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

    private static SyncService cap(String value) {
        return new SyncService(mock(SyncRepository.class), Clock.systemUTC(), new ObjectMapper(), 1000, 90, value);
    }

    @Test
    void recordCapUnsetEmptyOrZeroIsOffAndAWholeNumberIsAccepted() {
        for (String ok : new String[] {null, "", "  ", "0", "200000", " 5 "}) {
            assertThatCode(() -> cap(ok)).as("[" + ok + "]").doesNotThrowAnyException();
        }
    }

    @Test
    void aRecordCapThatIsNegativeOrNotANumberFailsStartup() {
        for (String bad : new String[] {"-1", "abc", "1.5", "200,000"}) {
            assertThatThrownBy(() -> cap(bad)).as(bad).isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("max-records-per-account");
        }
    }
}
