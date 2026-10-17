package app.plateandbar.api.observability;

import app.plateandbar.api.common.ApiException;
import io.sentry.Hint;
import io.sentry.SentryEvent;
import io.sentry.SentryOptions;
import io.sentry.protocol.Contexts;
import io.sentry.protocol.Request;
import io.sentry.protocol.SentryException;
import io.sentry.protocol.User;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * The {@code beforeSend} hook of every error event (#687). Keeps the exception type and stack trace and almost nothing
 * else: no bodies, query strings, cookies or unlisted headers, no exception or log messages (they can echo submitted
 * values), no breadcrumbs, one opaque user id, and no tag, extra or context named like food, weight, health or a token.
 */
@Component
public class SentryScrubber implements SentryOptions.BeforeSendCallback {

    private static final Set<String> SAFE_HEADERS = Set.of("user-agent", "content-type", "accept");
    private static final Pattern SENSITIVE = Pattern.compile(
            "(?i).*(food|meal|weight|health|answer|calorie|macro|token|email|password|secret|cookie|auth|session|code|note).*");
    private static final Pattern UUID_SEGMENT = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    @Override
    public SentryEvent execute(SentryEvent event, Hint hint) {
        Throwable t = event.getThrowable();
        if (t instanceof ApiException api && api.status().value() < 500) {
            return null; // an expected client error, not a bug
        }
        event.setRequest(request(event.getRequest()));
        event.setUser(user(event.getUser()));
        event.setBreadcrumbs(null);
        event.setMessage(null);
        event.setServerName(null);
        if (event.getExceptions() != null) {
            for (SentryException e : event.getExceptions()) {
                e.setValue(null);
            }
        }
        Map<String, String> tags = event.getTags();
        if (tags != null) {
            tags.keySet().removeIf(SentryScrubber::sensitive);
        }
        Map<String, Object> extras = event.getExtras();
        if (extras != null) {
            extras.keySet().removeIf(SentryScrubber::sensitive);
        }
        Contexts contexts = event.getContexts();
        for (String key : java.util.Collections.list(contexts.keys())) {
            if (sensitive(key) || "response".equals(key)) {
                contexts.remove(key);
            }
        }
        return event;
    }

    private static boolean sensitive(String key) {
        return key == null || SENSITIVE.matcher(key).matches();
    }

    private static Request request(Request in) {
        if (in == null) {
            return null;
        }
        Request out = new Request();
        out.setMethod(in.getMethod());
        String url = in.getUrl();
        if (url != null) {
            int cut = url.indexOf('?');
            if (cut >= 0) {
                url = url.substring(0, cut);
            }
            cut = url.indexOf('#');
            if (cut >= 0) {
                url = url.substring(0, cut);
            }
            out.setUrl(UUID_SEGMENT.matcher(url).replaceAll("{id}"));
        }
        if (in.getHeaders() != null) {
            Map<String, String> headers = new LinkedHashMap<>();
            in.getHeaders().forEach((k, v) -> {
                if (k != null && SAFE_HEADERS.contains(k.toLowerCase(Locale.ROOT))) {
                    headers.put(k, v);
                }
            });
            out.setHeaders(headers);
        }
        return out;
    }

    private static User user(User in) {
        if (in == null || in.getId() == null) {
            return null;
        }
        User out = new User();
        out.setId(opaque(in.getId()));
        return out;
    }

    static String opaque(String id) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d, 0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
