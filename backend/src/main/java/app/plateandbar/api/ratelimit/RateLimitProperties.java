package app.plateandbar.api.ratelimit;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Rate-limit settings ({@code app.rate-limit.*}). Every value has a default here and can be overridden
 * from the environment or configuration. Limits are token buckets: {@code capacity} requests per
 * {@code window}, refilled smoothly.
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public class RateLimitProperties {

    public static class Limit {
        private int capacity;
        private Duration window;

        public Limit() {}

        public Limit(int capacity, Duration window) {
            this.capacity = capacity;
            this.window = window;
        }

        public int getCapacity() {
            return capacity;
        }

        public void setCapacity(int capacity) {
            this.capacity = capacity;
        }

        public Duration getWindow() {
            return window;
        }

        public void setWindow(Duration window) {
            this.window = window;
        }
    }

    /** A short-window and a long-window limit applied together (both must allow the request). */
    public static class Caps {
        private Limit burst;
        private Limit sustained;

        public Caps(Limit burst, Limit sustained) {
            this.burst = burst;
            this.sustained = sustained;
        }

        public Limit getBurst() {
            return burst;
        }

        public void setBurst(Limit burst) {
            this.burst = burst;
        }

        public Limit getSustained() {
            return sustained;
        }

        public void setSustained(Limit sustained) {
            this.sustained = sustained;
        }
    }

    /** /health, per client IP (probes and uptime monitors; generous). */
    private Limit healthPerIp = new Limit(120, Duration.ofMinutes(1));
    /** Most distinct (scope, key) buckets held in memory; the least recently used are evicted beyond this. */
    private long maxTrackedKeys = 100_000;
    /** Same bound for the separate cache of per-address buckets, so IP floods cannot evict them. */
    private long addressMaxTrackedKeys = 100_000;
    /** Every endpoint under /auth, per client IP (Google sign-in, email start and verify, refresh). */
    private Limit publicPerIp = new Limit(30, Duration.ofMinutes(1));
    /** Extra cap on code requests per client IP. */
    private Limit emailStartPerIp = new Limit(10, Duration.ofHours(1));
    /** Extra cap on verify attempts per client IP. */
    private Limit emailVerifyPerIp = new Limit(30, Duration.ofHours(1));
    /** Every authenticated endpoint, per user id. */
    private Limit authenticatedPerUser = new Limit(120, Duration.ofMinutes(1));
    /** GET /me/export, per user id (on top of the per-user cap every endpoint has). */
    private Limit exportPerUser = new Limit(5, Duration.ofHours(1));
    /** GET /me/export, per client IP. */
    private Limit exportPerIp = new Limit(20, Duration.ofHours(1));
    /** The three POST /ai/* endpoints, per user id (on top of the per-user cap every endpoint has). */
    private Limit aiPerUser = new Limit(5, Duration.ofMinutes(1));
    /** Every /ai/* endpoint, per client IP. */
    private Limit aiPerIp = new Limit(60, Duration.ofMinutes(1));
    /** Codes issued per email address. */
    private Caps emailStartPerAddress =
            new Caps(new Limit(5, Duration.ofHours(1)), new Limit(10, Duration.ofDays(1)));
    /** Wrong codes per email address across all codes; a new code does not reset it. */
    private Caps verifyFailuresPerAddress =
            new Caps(new Limit(10, Duration.ofHours(1)), new Limit(20, Duration.ofDays(1)));
    /** IPs or CIDR ranges of reverse proxies whose X-Forwarded-For header is believed. Empty: never. */
    private List<String> trustedProxies = new ArrayList<>();

    public Limit getHealthPerIp() {
        return healthPerIp;
    }

    public void setHealthPerIp(Limit v) {
        this.healthPerIp = v;
    }

    public long getAddressMaxTrackedKeys() {
        return addressMaxTrackedKeys;
    }

    public void setAddressMaxTrackedKeys(long v) {
        this.addressMaxTrackedKeys = v;
    }

    public long getMaxTrackedKeys() {
        return maxTrackedKeys;
    }

    public void setMaxTrackedKeys(long v) {
        this.maxTrackedKeys = v;
    }

    public Limit getPublicPerIp() {
        return publicPerIp;
    }

    public void setPublicPerIp(Limit v) {
        this.publicPerIp = v;
    }

    public Limit getEmailStartPerIp() {
        return emailStartPerIp;
    }

    public void setEmailStartPerIp(Limit v) {
        this.emailStartPerIp = v;
    }

    public Limit getEmailVerifyPerIp() {
        return emailVerifyPerIp;
    }

    public void setEmailVerifyPerIp(Limit v) {
        this.emailVerifyPerIp = v;
    }

    public Limit getAuthenticatedPerUser() {
        return authenticatedPerUser;
    }

    public void setAuthenticatedPerUser(Limit v) {
        this.authenticatedPerUser = v;
    }

    public Limit getExportPerUser() {
        return exportPerUser;
    }

    public void setExportPerUser(Limit v) {
        this.exportPerUser = v;
    }

    public Limit getExportPerIp() {
        return exportPerIp;
    }

    public void setExportPerIp(Limit v) {
        this.exportPerIp = v;
    }

    public Limit getAiPerUser() {
        return aiPerUser;
    }

    public void setAiPerUser(Limit v) {
        this.aiPerUser = v;
    }

    public Limit getAiPerIp() {
        return aiPerIp;
    }

    public void setAiPerIp(Limit v) {
        this.aiPerIp = v;
    }

    public Caps getEmailStartPerAddress() {
        return emailStartPerAddress;
    }

    public void setEmailStartPerAddress(Caps v) {
        this.emailStartPerAddress = v;
    }

    public Caps getVerifyFailuresPerAddress() {
        return verifyFailuresPerAddress;
    }

    public void setVerifyFailuresPerAddress(Caps v) {
        this.verifyFailuresPerAddress = v;
    }

    public List<String> getTrustedProxies() {
        return trustedProxies;
    }

    public void setTrustedProxies(List<String> v) {
        this.trustedProxies = v == null ? new ArrayList<>() : v.stream().filter(s -> !s.isBlank()).toList();
    }
}
