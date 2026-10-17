package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

/** One account failing must not stop the walk (#667): the next accounts are still recounted. */
class RecordRecountSkipTest {

    @Test
    @SuppressWarnings("unchecked")
    void failingAccountsAreSkippedAndTheWalkContinues() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        TransactionTemplate tx = mock(TransactionTemplate.class);
        when(tx.execute(any())).thenAnswer(inv -> {
            TransactionCallback<Object> cb = inv.getArgument(0);
            return cb.doInTransaction(mock(TransactionStatus.class));
        });
        when(jdbc.queryForList(any(String.class), eq(String.class), any(), any()))
                .thenReturn(List.of("a", "b", "c", "d"))
                .thenReturn(List.of());
        when(jdbc.queryForList(any(String.class), eq(Long.class), eq("a"))).thenReturn(List.of(1L));
        when(jdbc.queryForList(any(String.class), eq(Long.class), eq("b")))
                .thenThrow(new CannotAcquireLockException("lock wait"));
        when(jdbc.queryForList(any(String.class), eq(Long.class), eq("c")))
                .thenThrow(new CannotCreateTransactionException("no connection"));
        when(jdbc.queryForList(any(String.class), eq(Long.class), eq("d"))).thenReturn(List.of(1L));
        when(jdbc.queryForObject(any(String.class), eq(Long.class), any(Object[].class))).thenReturn(5L);

        long corrected = new RecordRecount(jdbc, tx, "10").recountAll();

        assertThat(corrected).isEqualTo(2); // a and d, though b and c failed in between
        verify(jdbc).update(any(String.class), eq(5L), eq("d"));
    }
}
