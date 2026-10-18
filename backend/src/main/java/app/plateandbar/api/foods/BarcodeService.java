package app.plateandbar.api.foods;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.UpstreamException;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * {@code GET /foods/barcode/{code}} after the per-IP limit (a filter): validate the code (400), the feature switch, then
 * the cache (a hit or a recorded miss ends here and never touches the upstream limit), then Open Food Facts through
 * {@link OffClient} (which owns the shared upstream limit, 503 {@code upstream_busy}). Concurrent requests for one code
 * share one lookup. The barcode is never logged here.
 */
@Service
public class BarcodeService {
    private static final Logger log = LoggerFactory.getLogger(BarcodeService.class);

    private final OffProperties props;
    private final BarcodeCache cache;
    private final OffClient client;
    private final ObjectMapper mapper;
    private final ConcurrentHashMap<String, CompletableFuture<Optional<ObjectNode>>> inFlight = new ConcurrentHashMap<>();

    BarcodeService(OffProperties props, BarcodeCache cache, OffClient client, ObjectMapper mapper) {
        this.props = props;
        this.cache = cache;
        this.client = client;
        this.mapper = mapper;
    }

    /** The OffProduct answer. Throws 400 {@code invalid_barcode}, 404 {@code not_found} or 503 (see {@link UpstreamException}). */
    public JsonNode lookup(String code) {
        if (!Gs1.isValid(code)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_barcode", "That is not a valid barcode. Check the digits.");
        }
        if (!props.enabled()) {
            throw UpstreamException.unavailable();
        }
        return shared(code).orElseThrow(
                () -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "No product found for this barcode."));
    }

    private Optional<ObjectNode> shared(String code) {
        CompletableFuture<Optional<ObjectNode>> mine = new CompletableFuture<>();
        CompletableFuture<Optional<ObjectNode>> leader = inFlight.putIfAbsent(code, mine);
        if (leader != null) {
            try {
                return leader.get();
            } catch (ExecutionException e) {
                throw e.getCause() instanceof RuntimeException r ? r : UpstreamException.unavailable();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw UpstreamException.unavailable();
            }
        }
        try {
            Optional<ObjectNode> result = resolve(code);
            mine.complete(result);
            return result;
        } catch (RuntimeException e) {
            mine.completeExceptionally(e);
            throw e;
        } finally {
            inFlight.remove(code, mine);
        }
    }

    private Optional<ObjectNode> resolve(String code) {
        Optional<BarcodeCache.Entry> cached = cacheFind(code);
        if (cached.isPresent()) {
            BarcodeCache.Entry entry = cached.get();
            return entry.found() ? Optional.of((ObjectNode) mapper.readTree(entry.payload())) : Optional.empty();
        }
        Optional<ObjectNode> product = client.fetch(code).flatMap(p -> OffMapper.map(code, p));
        cacheStore(code, product.map(ObjectNode::toString).orElse(null));
        return product;
    }

    /** The cache is an optimisation: a database error there is a miss, not a failed lookup. */
    private Optional<BarcodeCache.Entry> cacheFind(String code) {
        try {
            return cache.find(code);
        } catch (DataAccessException e) {
            log.warn("Barcode cache read failed ({})", e.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    private void cacheStore(String code, String payload) {
        try {
            cache.put(code, payload);
        } catch (DataAccessException e) {
            log.warn("Barcode cache write failed ({})", e.getClass().getSimpleName());
        }
    }
}
