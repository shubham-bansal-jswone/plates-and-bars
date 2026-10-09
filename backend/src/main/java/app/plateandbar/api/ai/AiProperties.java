package app.plateandbar.api.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI settings ({@code app.ai.*}). Every feature is off by default (#200, decision 7), and a feature is only
 * on while its flag is set and the monthly token budget is a positive number not yet used up.
 */
@ConfigurationProperties(prefix = "app.ai")
public class AiProperties {

    /** Calls per user per UTC day, shared by all three endpoints. */
    private int dailyLimit = 10;
    /** Monthly cap on input plus output tokens across all users; 0 (the default) keeps every feature off. */
    private long monthlyBudgetTokens = 0;
    private boolean describeMealEnabled = false;
    private boolean askWhyEnabled = false;
    private boolean weeklySummaryEnabled = false;

    public boolean flag(AiFeature f) {
        return switch (f) {
            case DESCRIBE_MEAL -> describeMealEnabled;
            case ASK_WHY -> askWhyEnabled;
            case WEEKLY_SUMMARY -> weeklySummaryEnabled;
        };
    }

    public int getDailyLimit() {
        return dailyLimit;
    }

    public void setDailyLimit(int v) {
        this.dailyLimit = Math.max(0, v);
    }

    public long getMonthlyBudgetTokens() {
        return monthlyBudgetTokens;
    }

    public void setMonthlyBudgetTokens(long v) {
        this.monthlyBudgetTokens = Math.max(0, v);
    }

    public boolean isDescribeMealEnabled() {
        return describeMealEnabled;
    }

    public void setDescribeMealEnabled(boolean v) {
        this.describeMealEnabled = v;
    }

    public boolean isAskWhyEnabled() {
        return askWhyEnabled;
    }

    public void setAskWhyEnabled(boolean v) {
        this.askWhyEnabled = v;
    }

    public boolean isWeeklySummaryEnabled() {
        return weeklySummaryEnabled;
    }

    public void setWeeklySummaryEnabled(boolean v) {
        this.weeklySummaryEnabled = v;
    }
}
