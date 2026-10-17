package app.plateandbar.api.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import app.plateandbar.api.sync.SyncExporter;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** The streamed document's envelope, and what a failure after the first byte leaves behind. */
class AccountServiceStreamTest {

    static final String USER = "11111111-1111-1111-1111-111111111111";
    static final Instant AT = Instant.parse("2026-10-08T12:00:00Z");

    final ObjectMapper json = JsonMapper.builder().build();
    final AccountRepository accounts = mock(AccountRepository.class);
    final SyncExporter sync = mock(SyncExporter.class);
    final AccountService service = new AccountService(accounts, sync, json, Clock.systemUTC());

    private void account(String email) {
        when(accounts.find(USER))
                .thenReturn(Optional.of(new AccountRepository.Account(USER, email, Instant.parse("2026-10-01T06:30:00Z"))));
    }

    @Test
    void writesTheEnvelopeAroundTheTablesAndTheConflictLog() throws Exception {
        account(null);
        doAnswer(inv -> {
                    JsonGenerator g = inv.getArgument(1);
                    g.writeStartObject();
                    g.writeEndObject();
                    return null;
                })
                .when(sync)
                .writeTables(eq(USER), any());
        doAnswer(inv -> {
                    JsonGenerator g = inv.getArgument(1);
                    g.writeStartArray();
                    g.writeEndArray();
                    return null;
                })
                .when(sync)
                .writeConflictLog(eq(USER), any());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        long n = service.writeExport(USER, AT, out);
        assertThat(out.toString(StandardCharsets.UTF_8))
                .isEqualTo("{\"format_version\":1,\"exported_at\":\"2026-10-08T12:00:00Z\",\"user\":{\"id\":\"" + USER
                        + "\",\"email\":null,\"created_at\":\"2026-10-01T06:30:00Z\"},\"tables\":{},\"conflict_log\":[]}");
        assertThat(n).isEqualTo(out.size());
    }

    @Test
    void aFailureMidStreamPropagatesAndNeverLeavesAClosedDocument() {
        account("a@example.com");
        doAnswer(inv -> {
                    JsonGenerator g = inv.getArgument(1);
                    g.writeStartObject();
                    g.writeName("profiles");
                    g.writeStartArray();
                    throw new IllegalStateException("db went away");
                })
                .when(sync)
                .writeTables(eq(USER), any());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertThatThrownBy(() -> service.writeExport(USER, AT, out)).isInstanceOf(IllegalStateException.class);
        String partial = out.toString(StandardCharsets.UTF_8);
        assertThat(partial).contains("\"tables\":{\"profiles\":[");
        // Not repaired: no closing ] } was added by the generator on close.
        assertThat(partial).doesNotEndWith("}").doesNotEndWith("]");
        assertThatThrownBy(() -> json.readTree(partial)).isInstanceOf(Exception.class);
    }

    @Test
    void aMissingAccountIs401AndWritesNothing() {
        when(accounts.find(USER)).thenReturn(Optional.empty());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertThatThrownBy(() -> service.writeExport(USER, AT, out))
                .isInstanceOf(app.plateandbar.api.common.ApiException.class);
        assertThat(out.size()).isZero();
    }
}
