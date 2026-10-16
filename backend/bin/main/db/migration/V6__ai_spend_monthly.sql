-- Monthly AI token spend (security review M2). The monthly budget cap used to be the SUM over ai_usage, which is
-- deleted with the account, so deleting an account gave its spend back to the budget. This ledger holds one total
-- per UTC month and nothing else: no user id, no day, no feature, so it cannot be linked to a person and is not
-- personal data. It is therefore not touched by DELETE /me and not part of GET /me/export. ai_usage stays the
-- per-user quota counter and is still deleted with the account.
CREATE TABLE ai_spend_monthly (
    month  DATE   NOT NULL COMMENT 'First day of the UTC month',
    tokens BIGINT NOT NULL DEFAULT 0 COMMENT 'Input plus output tokens billed by the provider that month',
    PRIMARY KEY (month)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Carry over what ai_usage already recorded.
INSERT INTO ai_spend_monthly (month, tokens)
SELECT DATE_SUB(day, INTERVAL DAYOFMONTH(day) - 1 DAY), SUM(input_tokens + output_tokens)
FROM ai_usage
GROUP BY DATE_SUB(day, INTERVAL DAYOFMONTH(day) - 1 DAY);
