package app.plateandbar.api.sync;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Arrays;
import java.util.Optional;
import java.util.function.Function;

/**
 * The contract's {@code SyncTable} enum, in contract order. The constant's name is the table name in the
 * database and in the API, so {@link #sqlName()} is always one of these fixed strings (never user input).
 * Tables that are unique per natural key say how to read that key from a record; the record id must be
 * the UUIDv5 of {@code <table>:<key>} in the user's namespace (see {@link Uuids}).
 */
enum SyncTable {
    profiles(constant("me")),
    consents(null),
    food_logs(null),
    water_logs(null),
    day_notes(field("date")),
    workouts(field("date")),
    workout_sets(null),
    lift_stats(field("exercise")),
    weights(field("date")),
    measurements(field("date")),
    user_foods(null),
    recipes(null),
    kitchen_tests(null),
    exclusions(null),
    swaps(field("from")),
    settings(constant("me"));

    private final Function<JsonNode, String> naturalKey;

    SyncTable(Function<JsonNode, String> naturalKey) {
        this.naturalKey = naturalKey;
    }

    String sqlName() {
        return name();
    }

    /** The natural key of a record, or empty for tables whose ids are random UUIDs. */
    Optional<String> naturalKey(JsonNode record) {
        return naturalKey == null ? Optional.empty() : Optional.of(naturalKey.apply(record));
    }

    static Optional<SyncTable> byName(String name) {
        return Arrays.stream(values()).filter(t -> t.name().equals(name)).findFirst();
    }

    private static Function<JsonNode, String> constant(String value) {
        return r -> value;
    }

    private static Function<JsonNode, String> field(String name) {
        return r -> r.path(name).asText();
    }
}
