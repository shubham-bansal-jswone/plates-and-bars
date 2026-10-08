package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class CursorTest {

    @Test
    void cursorRoundTripsAndRejectsOtherShapes() {
        assertThat(Cursor.format(41969)).isEqualTo("c_000000000000a3f1");
        assertThat(Cursor.parse("c_000000000000a3f1")).hasValue(41969);
        assertThat(Cursor.parse("c_A3F1")).isEmpty();
        assertThat(Cursor.parse("x_000000000000a3f1")).isEmpty();
        assertThat(Cursor.parse("c_ffffffffffffffff")).isEmpty(); // negative as a long
        assertThat(Cursor.parse("")).isEmpty();
    }
}
