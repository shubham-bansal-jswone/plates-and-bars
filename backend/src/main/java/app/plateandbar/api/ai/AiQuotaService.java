package app.plateandbar.api.ai;

import app.plateandbar.api.common.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Feature switches, the monthly budget cap and the shared daily quota (UTC day). A unit is reserved before the
 * provider is called and released if the call fails, so concurrent calls cannot overrun the limit.
 */
@Service
public class AiQuotaService {

    /** A unit held for one call; hand it back to {@link #release} if the call does not end in a 200. */
    public record Reservation(String userId, LocalDate day, AiFeature feature, AiQuota quota) {}

    private final AiUsageRepository usage;
    private final AiProperties props;
    private final Clock clock;

    AiQuotaService(AiUsageRepository usage, AiProperties props, Clock clock) {
        this.usage = usage;
        this.props = props;
        this.clock = clock;
    }

    /** True while the flag is set and the monthly budget is set and not used up. */
    public boolean isOn(AiFeature feature) {
        if (!props.flag(feature) || props.getMonthlyBudgetTokens() <= 0) {
            return false;
        }
        LocalDate month = LocalDate.now(clock).withDayOfMonth(1);
        return usage.tokensBetween(month, month.plusMonths(1)) < props.getMonthlyBudgetTokens();
    }

    /** 503 {@code feature_disabled} unless the feature is on. */
    public void requireOn(AiFeature feature) {
        if (!isOn(feature)) {
            throw new ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "feature_disabled",
                    "This feature isn't available right now. You can enter it yourself instead.");
        }
    }

    @Transactional(readOnly = true)
    public AiQuota quota(String userId) {
        return quotaWith(usage.callsOn(userId, today()));
    }

    /** Reserves one unit or throws {@link QuotaExceededException}; 401 if the user no longer exists. */
    @Transactional
    public Reservation reserve(String userId, AiFeature feature) {
        usage.lockUser(userId).orElseThrow(ApiException::unauthorized);
        LocalDate day = today();
        int used = usage.callsOn(userId, day);
        if (used >= props.getDailyLimit()) {
            AiQuota q = quotaWith(used);
            throw new QuotaExceededException(q, Duration.between(clock.instant(), q.resetsAt()).toSeconds());
        }
        usage.addCall(userId, day, feature);
        return new Reservation(userId, day, feature, quotaWith(used + 1));
    }

    /** Gives a reserved unit back (the call failed). Safe to call once per reservation. */
    @Transactional
    public void release(Reservation r) {
        usage.removeCall(r.userId(), r.day(), r.feature());
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(ZoneOffset.UTC));
    }

    private AiQuota quotaWith(int used) {
        Instant resets = today().plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        return new AiQuota(props.getDailyLimit(), Math.max(0, props.getDailyLimit() - used), resets);
    }
}
