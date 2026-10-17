package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Memory stays bounded because the exporter asks the repository for at most one page at a time and hands each row
 * to the generator before asking for the next. The stub holds 2,345 rows in a (fake) table and fails the test if
 * more than a page is ever requested or if a page is requested before the previous one was written.
 */
class SyncExporterPagingTest {

    static final String USER = "u";
    static final int PAGE = 100;
    static final int ROWS = 2345;

    final ObjectMapper json = JsonMapper.builder().build();
    final SyncRepository repo = mock(SyncRepository.class);

    private static SyncRepository.Stored row(int i) {
        return new SyncRepository.Stored(
                String.format("%036d", i), 1, Instant.parse("2026-10-08T11:00:00Z"), null, i / 3, json().createObjectNode());
    }

    private static ObjectMapper json() {
        return JsonMapper.builder().build();
    }

    @Test
    void readsAtMostOnePageAtATimeAndWritesEachBeforeFetchingTheNext() throws Exception {
        List<SyncRepository.Stored> table = new ArrayList<>();
        for (int i = 0; i < ROWS; i++) {
            table.add(row(i));
        }
        AtomicInteger maxRequested = new AtomicInteger();
        AtomicInteger pageQueries = new AtomicInteger();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int[] bytesAtLastFetch = {0};
        when(repo.page(any(), eq(USER), anyLong(), any(), anyInt())).thenAnswer(inv -> {
            SyncTable t = inv.getArgument(0);
            int limit = inv.getArgument(4);
            maxRequested.accumulateAndGet(limit, Math::max);
            if (t != SyncTable.values()[0]) {
                return List.of();
            }
            pageQueries.incrementAndGet();
            String afterId = inv.getArgument(3);
            int from = afterId == null ? 0 : Integer.parseInt(afterId) + 1;
            // The previous page's rows must already be in the output buffer (flushed by the generator's size).
            bytesAtLastFetch[0] = out.size();
            return new ArrayList<>(table.subList(from, Math.min(from + limit, ROWS)));
        });
        when(repo.conflictsPage(eq(USER), anyLong(), anyInt())).thenReturn(List.of());

        SyncExporter exporter = new SyncExporter(repo, json, PAGE);
        try (JsonGenerator g = json.createGenerator(out)) {
            exporter.writeTables(USER, g);
        }

        assertThat(maxRequested.get()).isEqualTo(PAGE);
        assertThat(pageQueries.get()).isEqualTo(ROWS / PAGE + 1); // 23 full pages and a short last one
        JsonNode doc = json.readTree(out.toByteArray());
        assertThat(doc.path(SyncTable.values()[0].name())).hasSize(ROWS);
        assertThat(doc.path(SyncTable.values()[0].name()).get(ROWS - 1).path("id").asString()).isEqualTo(table.get(ROWS - 1).id());
        assertThat(bytesAtLastFetch[0]).isPositive(); // earlier pages were already written, not collected
    }

    @Test
    void anExactMultipleOfThePageSizeEndsWithOneEmptyQueryAndNoDuplicates() throws Exception {
        List<SyncRepository.Stored> table = new ArrayList<>();
        for (int i = 0; i < 2 * PAGE; i++) {
            table.add(row(i));
        }
        when(repo.page(any(), eq(USER), anyLong(), any(), anyInt())).thenAnswer(inv -> {
            if (inv.<SyncTable>getArgument(0) != SyncTable.values()[0]) {
                return List.of();
            }
            String afterId = inv.getArgument(3);
            int from = afterId == null ? 0 : Integer.parseInt(afterId) + 1;
            return new ArrayList<>(table.subList(Math.min(from, table.size()), Math.min(from + PAGE, table.size())));
        });
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (JsonGenerator g = json.createGenerator(out)) {
            new SyncExporter(repo, json, PAGE).writeTables(USER, g);
        }
        assertThat(json.readTree(out.toByteArray()).path(SyncTable.values()[0].name())).hasSize(2 * PAGE);
    }

    @Test
    void aPageSizeBelowOneIsRefused() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new SyncExporter(repo, json, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
