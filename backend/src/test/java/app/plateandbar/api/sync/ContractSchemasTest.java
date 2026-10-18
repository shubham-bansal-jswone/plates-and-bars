package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** The test helper's own rules (#883): the contract keeps Error open, the helper does not let a leak through. */
class ContractSchemasTest {

    @Test
    void anErrorBodyWithAnUnlistedKeyFails() {
        assertThatThrownBy(() -> ContractSchemas.assertResponse("POST /auth/google", 400,
                "{\"code\":\"invalid_request\",\"message\":\"bad\",\"stack\":\"at Foo.bar\"}"))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("stack");
    }

    @Test
    void anErrorBodyWithOnlyListedKeysPasses() {
        assertThatCode(() -> ContractSchemas.assertResponse("POST /auth/google", 400,
                "{\"code\":\"invalid_request\",\"message\":\"bad\"}")).doesNotThrowAnyException();
    }
}
