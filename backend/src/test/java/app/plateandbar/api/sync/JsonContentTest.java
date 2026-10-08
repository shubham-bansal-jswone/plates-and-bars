package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.obj;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class JsonContentTest {

    @Test
    void ignoresKeyOrderAndNumberForm() {
        assertThat(JsonContent.same(obj("{'a':60,'b':[1,{'c':2.50}]}"), obj("{'b':[1.0,{'c':2.5}],'a':60.0}"))).isTrue();
    }

    @Test
    void detectsAnyDifference() {
        assertThat(JsonContent.same(obj("{'a':1}"), obj("{'a':2}"))).isFalse();
        assertThat(JsonContent.same(obj("{'a':1}"), obj("{'a':1,'b':null}"))).isFalse();
        assertThat(JsonContent.same(obj("{'a':[1,2]}"), obj("{'a':[2,1]}"))).isFalse();
        assertThat(JsonContent.same(obj("{'a':null}"), obj("{'a':0}"))).isFalse();
        assertThat(JsonContent.same(obj("{'a':'1'}"), obj("{'a':1}"))).isFalse();
    }
}
