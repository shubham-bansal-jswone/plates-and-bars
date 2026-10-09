package app.plateandbar.api.content;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** GET /content/manifest and GET /content/{bundle}: public, byte-for-byte, strong-ETag cacheable. */
@RestController
public class ContentController {

    static final int MAX_IF_NONE_MATCH = 1024;
    private static final String TAG = "(?:W/)?\"[\\x21\\x23-\\x7E\\x80-\\xFF]*\"";
    private static final Pattern HEADER = Pattern.compile("^\\s*(?:\\*|(?:" + TAG + ")?(?:\\s*,\\s*(?:" + TAG + ")?)*)\\s*$");
    private static final Pattern ONE_TAG = Pattern.compile(TAG);

    private final ContentBundles content;

    public ContentController(ContentBundles content) {
        this.content = content;
    }

    @GetMapping("/api/v1/content/manifest")
    public void manifest(HttpServletRequest request, HttpServletResponse response) throws IOException {
        respond(request, response, content.manifest(), "public, max-age=300");
    }

    @GetMapping("/api/v1/content/{bundle}")
    public void bundle(@PathVariable String bundle, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        if (!ContentBundles.NAME.matcher(bundle).matches()) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "invalid_request",
                    "The request is not valid.",
                    List.of(new ErrorResponse.Detail("bundle", "invalid")));
        }
        ContentBundles.Served served = content.bundle(bundle);
        if (served == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "Not found.");
        }
        respond(request, response, served, "public, no-cache");
    }

    /**
     * Written straight to the servlet response, not returned as a ResponseEntity: Spring would otherwise run its own,
     * more lenient If-None-Match check on a 200 with an ETag and turn a header the contract says to ignore into a 304.
     */
    private static void respond(
            HttpServletRequest request, HttpServletResponse response, ContentBundles.Served served, String cacheControl)
            throws IOException {
        response.setHeader(HttpHeaders.ETAG, served.etag());
        response.setHeader(HttpHeaders.CACHE_CONTROL, cacheControl);
        response.addHeader(HttpHeaders.VARY, HttpHeaders.ACCEPT_ENCODING);
        if (matches(request, served.etag())) {
            response.setStatus(HttpServletResponse.SC_NOT_MODIFIED);
            return;
        }
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType("application/json;charset=UTF-8");
        response.setContentLength(served.body().length);
        response.getOutputStream().write(served.body());
    }

    /** RFC 9110 If-None-Match with weak comparison; empty list elements are skipped; a header that is too long or does not parse counts as absent. */
    static boolean matches(HttpServletRequest request, String etag) {
        String header = String.join(",", Collections.list(request.getHeaders(HttpHeaders.IF_NONE_MATCH)));
        if (header.isBlank() || header.length() > MAX_IF_NONE_MATCH || !HEADER.matcher(header).matches()) {
            return false;
        }
        if (header.trim().equals("*")) {
            return true;
        }
        var m = ONE_TAG.matcher(header);
        while (m.find()) {
            String tag = m.group();
            if ((tag.startsWith("W/") ? tag.substring(2) : tag).equals(etag)) {
                return true;
            }
        }
        return false;
    }
}
