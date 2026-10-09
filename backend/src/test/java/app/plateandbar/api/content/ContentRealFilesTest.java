package app.plateandbar.api.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.support.WebMvcAuthSlice;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

/** The jar's real classpath: every content/*.json in the repository is served, no allow-list. */
@WebMvcTest(ContentController.class)
@WebMvcAuthSlice
@Import(ContentBundles.class)
class ContentRealFilesTest {

    // CONTENT_UPDATED_AT is set by build.gradle for the test task, one value per file in ../content.
    @Autowired MockMvc mvc;

    @Test
    void everyContentFileIsInTheManifestAndServedByteForByte() throws Exception {
        List<Path> files;
        try (Stream<Path> s = Files.list(Path.of("..", "content"))) {
            files = s.filter(p -> p.getFileName().toString().endsWith(".json")).sorted().toList();
        }
        assertThat(files.size()).isGreaterThanOrEqualTo(9);
        String manifest = mvc.perform(get("/api/v1/content/manifest")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode bundles = ContentBundlesTest.JSON.readTree(manifest).path("bundles");
        assertThat(bundles.findValuesAsText("name")).containsExactlyElementsOf(
                files.stream().map(p -> p.getFileName().toString().replace(".json", "")).toList());
        for (Path f : files) {
            String name = f.getFileName().toString().replace(".json", "");
            byte[] bytes = Files.readAllBytes(f);
            byte[] served = mvc.perform(get("/api/v1/content/" + name)).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsByteArray();
            assertThat(served).as(name).isEqualTo(bytes);
            JsonNode entry = bundles.findParents("name").stream().filter(n -> n.path("name").asText().equals(name)).findFirst().orElseThrow();
            assertThat(entry.path("sha256").asText()).isEqualTo(ContentBundles.sha256(bytes));
            assertThat(entry.path("size_bytes").asInt()).isEqualTo(bytes.length);
        }
    }
}
