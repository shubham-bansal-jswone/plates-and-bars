package app.plateandbar.api.auth;

import app.plateandbar.api.auth.AuthDtos.EmailStartResponse;
import app.plateandbar.api.auth.AuthDtos.TokenPair;
import app.plateandbar.api.auth.AuthDtos.UserDto;
import app.plateandbar.api.auth.UserRepository.User;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimitedException;
import app.plateandbar.api.ratelimit.RateLimiter;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.function.Supplier;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Sign-in, email codes and refresh rotation (ADR 003, ADR 004). Failures that must persist state
 * (wrong-attempt counts, family revocation) are returned from the transaction and thrown after commit.
 */
@Service
public class AuthService {

    static final Duration REFRESH_TTL = Duration.ofDays(90);
    static final Duration CODE_TTL = Duration.ofMinutes(10);
    static final int RESEND_AFTER_SECONDS = 60;
    static final int MAX_CODE_ATTEMPTS = 5;

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private record Resolved(User user, boolean isNew) {}

    private final GoogleIdTokenVerifier google;
    private final JwtService jwt;
    private final MailSender mail;
    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final EmailCodeRepository codes;
    private final EmailVerifyFailureRepository failures;
    private final RateLimiter limiter;
    private final RateLimitProperties limits;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final byte[] codeKey;

    public AuthService(
            GoogleIdTokenVerifier google,
            JwtService jwt,
            MailSender mail,
            UserRepository users,
            RefreshTokenRepository refreshTokens,
            EmailCodeRepository codes,
            EmailVerifyFailureRepository failures,
            RateLimiter limiter,
            RateLimitProperties limits,
            PlatformTransactionManager txManager,
            Clock clock,
            AuthProperties props) {
        this.google = google;
        this.jwt = jwt;
        this.mail = mail;
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.codes = codes;
        this.failures = failures;
        this.limiter = limiter;
        this.limits = limits;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
        this.codeKey = hmac(props.jwtSigningKey().getBytes(StandardCharsets.UTF_8), "email-code-v1");
    }

    public TokenPair signInWithGoogle(String idToken) {
        GoogleIdTokenVerifier.GoogleIdentity id = google.verify(idToken);
        return inTxRetryingOnRace(() -> {
            Resolved r = resolveUser("google", id.subject(), id.email());
            return issue(r.user(), newFamily(), r.isNew());
        });
    }

    public EmailStartResponse startEmailSignIn(String rawEmail) {
        String email = Emails.normalise(rawEmail);
        // Per address, before anything is written or sent. Applies whether or not an account exists.
        limiter.consume(
                "email-start-address",
                email,
                limits.getEmailStartPerAddress().getBurst(),
                limits.getEmailStartPerAddress().getSustained());
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        Instant now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        Instant expiresAt = now.plus(CODE_TTL);
        tx.executeWithoutResult(s -> {
            codes.deleteExpired(now);
            codes.replace(email, hashCode(email, code), expiresAt, now);
        });
        // Pruning is a separate statement, outside the code-row transaction, so it cannot take part in a deadlock.
        failures.deleteOlderThan(now.minus(longestFailureWindow()));
        try {
            mail.sendSignInCode(email, code, expiresAt);
        } catch (RuntimeException e) {
            // Still 202: the endpoint must not reveal whether an address can receive mail.
            log.warn("Sign-in code delivery failed ({})", e.getClass().getSimpleName());
        }
        return new EmailStartResponse(expiresAt, RESEND_AFTER_SECONDS);
    }

    public TokenPair verifyEmailSignIn(String rawEmail, String code) {
        String email = Emails.normalise(rawEmail);
        TokenPair pair = inTxRetryingOnRace(() -> {
            Instant now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
            var row = codes.findForUpdate(email);
            // Cap on wrong codes per address across all codes. Checked under the code row lock so
            // parallel guesses cannot overshoot it; a blocked attempt is refused even if the code is right.
            long wait = failureCapWaitSeconds(email, now);
            if (wait > 0) {
                throw new RateLimitedException(wait);
            }
            if (row.isEmpty()) {
                return null;
            }
            var c = row.get();
            if (c.usedAt() != null || !now.isBefore(c.expiresAt()) || c.attempts() >= MAX_CODE_ATTEMPTS) {
                return null;
            }
            if (!MessageDigest.isEqual(
                    hashCode(email, code).getBytes(StandardCharsets.UTF_8),
                    c.codeHash().getBytes(StandardCharsets.UTF_8))) {
                codes.recordWrongAttempt(email);
                failures.record(email, now);
                return null;
            }
            codes.markUsed(email, now);
            Resolved r = resolveUser("email", email, email);
            return issue(r.user(), newFamily(), r.isNew());
        });
        if (pair == null) {
            throw ApiException.invalidCode();
        }
        return pair;
    }

    private Duration longestFailureWindow() {
        var caps = limits.getVerifyFailuresPerAddress();
        return caps.getBurst().getWindow().compareTo(caps.getSustained().getWindow()) > 0
                ? caps.getBurst().getWindow()
                : caps.getSustained().getWindow();
    }

    /** Seconds until the address may try again, or 0 when under both caps (rolling windows). */
    private long failureCapWaitSeconds(String email, Instant now) {
        long wait = 0;
        var caps = limits.getVerifyFailuresPerAddress();
        for (var l : java.util.List.of(caps.getBurst(), caps.getSustained())) {
            var recent = failures.newest(email, now.minus(l.getWindow()), l.getCapacity());
            if (recent.size() >= l.getCapacity()) {
                // Blocked until the oldest of the counted failures leaves the window.
                Instant frees = recent.get(l.getCapacity() - 1).plus(l.getWindow());
                wait = Math.max(wait, Math.max(1, Duration.between(now, frees).plusMillis(999).toSeconds()));
            }
        }
        return wait;
    }

    public TokenPair refresh(String presented) {
        String hash = sha256Hex(presented);
        TokenPair pair = tx.execute(s -> {
            Instant now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
            var found = refreshTokens.findByHashForUpdate(hash);
            if (found.isEmpty()) {
                return null;
            }
            var row = found.get();
            if (row.rotatedAt() != null) {
                // Reuse of a rotated token: treat as theft and end the whole session.
                refreshTokens.revokeFamily(row.familyId(), now);
                return null;
            }
            if (row.revokedAt() != null || !now.isBefore(row.expiresAt())) {
                return null;
            }
            var user = users.findById(row.userId());
            if (user.isEmpty()) {
                return null;
            }
            refreshTokens.markRotated(row.id(), now);
            return issue(user.get(), row.familyId(), false);
        });
        if (pair == null) {
            throw ApiException.sessionEnded();
        }
        return pair;
    }

    /** Google identities are keyed by sub; email is used once to join an existing account (ADR 004). */
    private Resolved resolveUser(String provider, String subject, String email) {
        Instant now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        var byIdentity = users.findByIdentity(provider, subject);
        if (byIdentity.isPresent()) {
            return new Resolved(byIdentity.get(), false);
        }
        var byEmail = users.findByEmail(email);
        if (byEmail.isPresent()) {
            users.linkIdentity(byEmail.get().id(), provider, subject, now);
            return new Resolved(byEmail.get(), false);
        }
        User created = users.create(email, now);
        users.linkIdentity(created.id(), provider, subject, now);
        return new Resolved(created, true);
    }

    private TokenPair issue(User user, String familyId, boolean isNew) {
        Instant now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        JwtService.AccessToken access = jwt.issue(user.id());
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        String refresh = "rt_" + Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        Instant refreshExpires = now.plus(REFRESH_TTL);
        refreshTokens.insert(user.id(), familyId, sha256Hex(refresh), refreshExpires, now);
        return new TokenPair(
                "Bearer",
                access.value(),
                access.expiresAt(),
                refresh,
                refreshExpires,
                new UserDto(user.id(), user.email(), user.createdAt()),
                isNew);
    }

    /** Two first sign-ins racing on the same new account hit a unique key; the second attempt then finds it. */
    private <T> T inTxRetryingOnRace(Supplier<T> work) {
        try {
            return tx.execute(s -> work.get());
        } catch (DuplicateKeyException e) {
            return tx.execute(s -> work.get());
        }
    }

    private static String newFamily() {
        return java.util.UUID.randomUUID().toString();
    }

    private static String sha256Hex(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] hmac(byte[] key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** HMAC so a leaked table cannot be brute-forced offline without the server key. */
    private String hashCode(String email, String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(codeKey, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal((email + ":" + code).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
