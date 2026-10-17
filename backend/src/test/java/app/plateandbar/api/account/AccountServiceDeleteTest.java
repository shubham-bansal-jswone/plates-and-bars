package app.plateandbar.api.account;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import app.plateandbar.api.sync.SyncExporter;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import tools.jackson.databind.json.JsonMapper;

/** DELETE /me ordering: the ledger entry is written first and a failed write deletes nothing. */
class AccountServiceDeleteTest {

    static final String USER = "11111111-1111-1111-1111-111111111111";
    static final Instant AT = Instant.parse("2026-10-18T10:15:30Z");

    final AccountRepository accounts = mock(AccountRepository.class);
    final ErasureLedger ledger = mock(ErasureLedger.class);
    final AccountService service = new AccountService(
            accounts, mock(SyncExporter.class), JsonMapper.builder().build(), Clock.fixed(AT, ZoneOffset.UTC), ledger);

    @Test
    void recordsTheErasureOnceAndBeforeDeleting() {
        service.delete(USER);
        InOrder order = inOrder(ledger, accounts);
        order.verify(ledger).record(USER, AT);
        order.verify(accounts).deleteAll(USER);
        verify(ledger, org.mockito.Mockito.times(1)).record(any(), any());
    }

    @Test
    void aFailedLedgerWriteDeletesNothing() {
        doThrow(new ErasureLedgerException("erasure ledger not writable", null)).when(ledger).record(USER, AT);
        assertThatThrownBy(() -> service.delete(USER)).isInstanceOf(ErasureLedgerException.class);
        verify(accounts, never()).deleteAll(any());
    }
}
