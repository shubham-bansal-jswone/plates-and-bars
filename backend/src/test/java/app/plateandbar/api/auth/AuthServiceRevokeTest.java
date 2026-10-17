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

class AuthServiceRevokeTest {

    private static final Instant NOW = Instant.parse("2026-10-15T10:00:00Z");

    private final RefreshTokenRepository refreshTokens = mock(RefreshTokenRepository.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
    private AuthService auth;

    @BeforeEach
    void setUp() {
        when(txManager.getTransaction(any())).thenAnswer(i -> new SimpleTransactionStatus());
        auth = new AuthService(
                mock(GoogleIdTokenVerifier.class),
                mock(JwtService.class),
                mock(MailSender.class),
                mock(UserRepository.class),
                refreshTokens,
                mock(EmailCodeRepository.class),
                mock(EmailVerifyFailureRepository.class),
                mock(RateLimiter.class),
                new RateLimitProperties(),
                txManager,
                Clock.fixed(NOW, ZoneOffset.UTC),
                new AuthProperties("test-signing-key-at-least-32-bytes-long", List.of()));
    }

    private static RefreshTokenRepository.Row row(Instant expires, Instant rotated, Instant revoked) {
        return new RefreshTokenRepository.Row("t0", "u1", "f1", expires, rotated, revoked, null);
    }

    @Test
    void anyKnownTokenRevokesItsWholeFamilyWhetherCurrentRotatedExpiredOrAlreadyRevoked() {
        for (var r : List.of(
                row(NOW.plusSeconds(3600), null, null), // current
                row(NOW.plusSeconds(3600), NOW.minusSeconds(5), null), // rotated
                row(NOW.minusSeconds(1), null, null), // expired
                row(NOW.plusSeconds(3600), null, NOW.minusSeconds(9)))) { // already revoked
            when(refreshTokens.findByHashForUpdate(anyString())).thenReturn(Optional.of(r));
            auth.revokeSession("rt_any");
        }
        verify(refreshTokens, times(4)).revokeFamily("f1", NOW);
    }

    @Test
    void anUnknownTokenRevokesNothingAndIsNotAnError() {
        when(refreshTokens.findByHashForUpdate(anyString())).thenReturn(Optional.empty());
        auth.revokeSession("rt_unknown");
        verify(refreshTokens, never()).revokeFamily(anyString(), any());
    }

    @Test
    void theLookupIsByHashNeverByTheTokenItself() {
        when(refreshTokens.findByHashForUpdate(anyString())).thenReturn(Optional.empty());
        auth.revokeSession("rt_plain_token");
        var hash = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(refreshTokens).findByHashForUpdate(hash.capture());
        assertThat(hash.getValue()).hasSize(64).doesNotContain("rt_plain_token");
    }

    @Test
    void aDeadlockIsRetriedOnceThenAnswered503() {
        when(refreshTokens.findByHashForUpdate(anyString()))
                .thenThrow(new PessimisticLockingFailureException("Deadlock found"))
                .thenReturn(Optional.of(row(NOW.plusSeconds(3600), null, null)));
        auth.revokeSession("rt_x");
        verify(refreshTokens).revokeFamily("f1", NOW);

        when(refreshTokens.findByHashForUpdate(anyString()))
                .thenThrow(new PessimisticLockingFailureException("Deadlock found"))
                .thenThrow(new CannotAcquireLockException("Lock wait timeout exceeded"));
        assertThatThrownBy(() -> auth.revokeSession("rt_x")).isInstanceOf(ServiceUnavailableException.class);
    }
}
