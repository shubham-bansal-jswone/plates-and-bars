-- Whether this month's 80% budget alert has fired (#689). Kept in the ledger row so it survives restarts and is
-- claimed with one conditional UPDATE. Still no user data.
ALTER TABLE ai_spend_monthly
    ADD COLUMN alert_sent TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 once the 80% budget WARN has been logged for the month';
