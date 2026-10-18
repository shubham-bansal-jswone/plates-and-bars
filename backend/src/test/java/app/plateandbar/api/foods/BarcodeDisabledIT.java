package app.plateandbar.api.foods;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.sync.ContractSchemas;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.ObjectMapper;

/** The feature flag (app.off.enabled) is off by default: nothing is called and the answer is the documented 503. */
class BarcodeDisabledIT extends BarcodeITBase {

    @Test
    void offByDefaultAnswers503UnavailableAndCallsNothing() {
        String code = code(80);
        script(code, json(200, product(code)));
        ResponseEntity<String> r = get(code);
        assertThat(r.getStatusCode().value()).isEqualTo(503);
        ContractSchemas.assertResponse("GET /foods/barcode/{code}", 503, r.getBody());
        assertThat(new ObjectMapper().readTree(r.getBody()).path("code").asString()).isEqualTo("upstream_unavailable");
        assertThat(REQUESTS).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM barcode_cache", Integer.class)).isZero();
    }

    @Test
    void anInvalidCodeIsStill400WhileOff() {
        ResponseEntity<String> r = get("8901491101838");
        assertThat(r.getStatusCode().value()).isEqualTo(400);
        ContractSchemas.assertResponse("GET /foods/barcode/{code}", 400, r.getBody());
    }
}
