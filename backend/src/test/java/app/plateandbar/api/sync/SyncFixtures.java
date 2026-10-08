package app.plateandbar.api.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;

/** Valid example records for the sync tests. Single quotes stand in for double quotes in the JSON literals. */
final class SyncFixtures {
    static final ObjectMapper JSON = new ObjectMapper();

    private SyncFixtures() {}

    static ObjectNode obj(String singleQuoted) {
        try {
            return (ObjectNode) JSON.readTree(singleQuoted.replace('\'', '"'));
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    static String id() {
        return UUID.randomUUID().toString();
    }

    static String naturalId(String userId, String table, String key) {
        return Uuids.v5(UUID.fromString(userId), table + ":" + key).toString();
    }

    /** A request under construction: {@code Req.of(cursor).add(table, record)...build()}. */
    static final class Req {
        private final ObjectNode root = JSON.createObjectNode();
        private final ObjectNode changes = root.putObject("changes");

        static Req of(String cursor) {
            Req r = new Req();
            if (cursor == null) {
                r.root.putNull("cursor");
            } else {
                r.root.put("cursor", cursor);
            }
            return r;
        }

        Req add(SyncTable table, ObjectNode record) {
            ((ArrayNode) changes.withArray(table.name())).add(record);
            return this;
        }

        ObjectNode build() {
            return root;
        }
    }

    static ObjectNode withMeta(ObjectNode fields, String id, int version, String updatedAt, String deletedAt) {
        ObjectNode r = JSON.createObjectNode();
        r.put("id", id);
        r.put("version", version);
        r.put("updated_at", updatedAt);
        if (deletedAt == null) {
            r.putNull("deleted_at");
        } else {
            r.put("deleted_at", deletedAt);
        }
        r.setAll(fields);
        return r;
    }

    static ObjectNode foodLog(String id, int version, String updatedAt, String deletedAt, String name, double kcal) {
        ObjectNode f = obj("{'date':'2026-10-08','meal':'Breakfast','qty':1,'protein_g':6.3,'carbs_g':43.5,'fat_g':10.3,'food_id':null}");
        f.put("name", name);
        f.put("kcal", kcal);
        return withMeta(f, id, version, updatedAt, deletedAt);
    }

    static ObjectNode waterLog(String id, int version, String updatedAt, String deletedAt, int ml) {
        ObjectNode f = obj("{'date':'2026-10-08'}");
        f.put("ml", ml);
        return withMeta(f, id, version, updatedAt, deletedAt);
    }

    /** One valid, never-synced (version 0) record for every table, with natural-key ids derived for {@code userId}. */
    static Map<SyncTable, ObjectNode> oneOfEach(String userId, String updatedAt) {
        Map<SyncTable, ObjectNode> m = new EnumMap<>(SyncTable.class);
        String day = "2026-10-08";
        m.put(SyncTable.profiles, withMeta(obj("""
                {'sex':'female','age':30,'height_cm':165,'weight_kg':62.5,'activity':'light','where':'gym','days':4,
                 'exp':'some','minutes':60,'goal':'recomp','pace':'moderate','special':'none',
                 'screen':['no','no','no','no','no','no'],'created':'2026-10-01','cleared':null,
                 'targets':{'kcal':2000,'protein_g':120,'carbs_g':200,'fat_g':60}}"""),
                naturalId(userId, "profiles", "me"), 0, updatedAt, null));
        m.put(SyncTable.consents, withMeta(obj(
                "{'kind':'data_storage','given_at':'2026-10-08T06:30:00Z','text_version':'2026-10-07'}"),
                id(), 0, updatedAt, null));
        m.put(SyncTable.food_logs, foodLog(id(), 0, updatedAt, null, "Poha", 291));
        m.put(SyncTable.water_logs, waterLog(id(), 0, updatedAt, null, 250));
        m.put(SyncTable.day_notes, withMeta(obj(
                "{'date':'" + day + "','complete':true,'steps':8000,'sleep':7.5,'fast':false}"),
                naturalId(userId, "day_notes", day), 0, updatedAt, null));
        m.put(SyncTable.workouts, withMeta(obj("""
                {'date':'2026-10-08','template':'Upper A','base':'Upper A','where':null,'cardio_min':10,'mods':{},
                 'exercises':[{'name':'Barbell Bench Press','part':1,'bridge':false,'form':'yes','found_kg':60,'skip_ramp':false}],
                 'ci_choice':null}"""),
                naturalId(userId, "workouts", day), 0, updatedAt, null));
        m.put(SyncTable.workout_sets, withMeta(obj(
                "{'workout_id':'" + naturalId(userId, "workouts", day) + "','exercise':'Barbell Bench Press','kind':'work',"
                        + "'set_index':0,'weight_kg':60,'reps':8,'done':true,'rate':'right','t':'2026-10-08T12:31:00Z'}"),
                id(), 0, updatedAt, null));
        m.put(SyncTable.lift_stats, withMeta(obj("""
                {'exercise':'Barbell Bench Press','date':'2026-10-08','sets':[{'weight_kg':60,'reps':8,'rate':'right'}],
                 'form':'yes','sessions':3,'first':'2026-09-20','prev':null,
                 'history':[{'date':'2026-10-08','score':1.5}],'pb_toast_date':null}"""),
                naturalId(userId, "lift_stats", "Barbell Bench Press"), 0, updatedAt, null));
        m.put(SyncTable.weights, withMeta(obj("{'date':'" + day + "','weight_kg':81.4}"),
                naturalId(userId, "weights", day), 0, updatedAt, null));
        m.put(SyncTable.measurements, withMeta(obj(
                "{'date':'" + day + "','waist_cm':80,'neck_cm':null,'chest_cm':null,'arm_cm':null,'thigh_cm':null,'hips_cm':null}"),
                naturalId(userId, "measurements", day), 0, updatedAt, null));
        m.put(SyncTable.user_foods, withMeta(obj(
                "{'name':'Dal','unit':'1 katori','kcal':150,'protein_g':9,'carbs_g':20,'fat_g':4,'fibre_g':null,"
                        + "'added_sugar_g':null,'fruit_veg_servings':null,'origin':'custom'}"),
                id(), 0, updatedAt, null));
        m.put(SyncTable.recipes, withMeta(obj(
                "{'name':'Dal','ingredients':[{'ingredient':'Toor dal (dry)','amount':50,'unit':'g'}],"
                        + "'yield_mode':'katori','katoris':4,'cooked_g':null,'oil':'normal'}"),
                id(), 0, updatedAt, null));
        m.put(SyncTable.kitchen_tests, withMeta(obj(
                "{'name':'Khichdi','date':'" + day + "','note':'','ingredients':[],'pot_g':null,'pot_full_g':null,"
                        + "'cooked_g':500,'serving_g':150,'serving_name':'katori','has_photo':false}"),
                id(), 0, updatedAt, null));
        m.put(SyncTable.exclusions, withMeta(obj(
                "{'name':'Barbell Bench Press','scope':'exercise','key':'Barbell Bench Press','reason':'pain',"
                        + "'created':'2026-10-08','until':null,'to':{'Barbell Bench Press':null},'done':false}"),
                id(), 0, updatedAt, null));
        m.put(SyncTable.swaps, withMeta(obj(
                "{'from':'Barbell Bench Press','to':'Dumbbell Bench Press','since':'2026-10-08','bridge_until':null}"),
                naturalId(userId, "swaps", "Barbell Bench Press"), 0, updatedAt, null));
        m.put(SyncTable.settings, withMeta(obj("""
                {'focus':['chest'],'rest_off':false,'custom_tags':{},'diet':'any',
                 'water_sizes':{'glass_ml':250,'bottle_ml':1000},'exercise_overrides':{},'flex':[],'returning':{},
                 'ladder_stay':{},'checkin_seen':null,'adjustments':{},'adaptive':{},'learn':{},'meal_plan':null,'prep':[]}"""),
                naturalId(userId, "settings", "me"), 0, updatedAt, null));
        return m;
    }

    static JsonNode copy(JsonNode n) {
        return n.deepCopy();
    }
}
