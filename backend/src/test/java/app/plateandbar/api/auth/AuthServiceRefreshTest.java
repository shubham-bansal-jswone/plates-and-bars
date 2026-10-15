package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import app.plateandbar.api.auth.UserRepository.User;
import app.plateandbar.api.common.ServiceUnavailableException;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

/** A refresh that loses a database deadlock is retried once, then answered 503 (never 500 or session_ended). */
class AuthServiceRefreshTest {

    private static final Instant NOW = Instant.parse("2026-10-15T10:00:00Z");
    private static final User USER = new User("u1", "asha@example.com", NOW);
    private static final RefreshTokenRepository.Row ROW =
            new RefreshTokenRepository.Row("t0", "u1", "f1", NOW.plusSeconds(3600), null, null, null);

    private final RefreshTokenRepository refreshTokens = mock(RefreshTokenRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final JwtService jwt = mock(JwtService.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
    private AuthService auth;

    @BeforeEach
    void setUp() {
        when(txManager.getTransaction(any())).thenAnswer(i -> new SimpleTransactionStatus());
        when(users.findById("u1")).thenReturn(Optional.of(USER));
        when(jwt.issue("u1")).thenReturn(new JwtService.AccessToken("access", NOW.plusSeconds(900)));
        auth = new AuthService(
                mock(GoogleIdTokenVerifier.class),
                jwt,
                mock(MailSender.class),
                users,
                refreshTokens,
                mock(EmailCodeRepository.class),
                mock(EmailVerifyFailureRepository.class),
                mock(RateLimiter.class),
                new RateLimitProperties(),
                txManager,
                Clock.fixed(NOW, ZoneOffset.UTC),
                new AuthProperties("test-signing-key-at-least-32-bytes-long", List.of()));
    }

    @Test
    void deadlockThenSuccessRetriesOnceAndRotates() {
        when(refreshTokens.findByHashForUpdate(anyString()))
                .thenThrow(new PessimisticLockingFailureException("Deadlock found when trying to get lock"))
                .thenReturn(Optional.of(ROW));

        var pair = auth.refresh("rt_old");

        assertThat(pair.refreshToken()).startsWith("rt_");
        verify(refreshTokens, times(2)).findByHashForUpdate(anyString());
        verify(refreshTokens).markRotated("t0", NOW);
        verify(txManager).rollback(any());
    }

    @Test
    void deadlockTwiceIsServiceUnavailableAndRevokesNothing() {
        when(refreshTokens.findByHashForUpdate(anyString()))
                .thenThrow(new PessimisticLockingFailureException("Deadlock found when trying to get lock"))
                .thenThrow(new CannotAcquireLockException("Lock wait timeout exceeded"));

        assertThatThrownBy(() -> auth.refresh("rt_old"))
                .isInstanceOf(ServiceUnavailableException.class)
                .hasCauseInstanceOf(CannotAcquireLockException.class);
        verify(refreshTokens, times(2)).findByHashForUpdate(anyString());
        verify(refreshTokens, never()).revokeFamily(anyString(), any());
        verify(refreshTokens, never()).markRotated(anyString(), any());
        verify(txManager, times(2)).rollback(any());
    }
}
