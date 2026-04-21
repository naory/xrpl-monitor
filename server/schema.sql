CREATE TABLE IF NOT EXISTS trade_fills (
    id            SERIAL PRIMARY KEY,
    ledger_index  BIGINT NOT NULL,
    ledger_time   TIMESTAMP NOT NULL,
    tx_hash       VARCHAR(64) NOT NULL,
    account       VARCHAR(64) NOT NULL,
    gets_currency VARCHAR(64) NOT NULL,
    gets_issuer   VARCHAR(64),
    gets_value    NUMERIC(38, 18) NOT NULL,
    pays_currency VARCHAR(64) NOT NULL,
    pays_issuer   VARCHAR(64),
    pays_value    NUMERIC(38, 18) NOT NULL,
    price         NUMERIC(38, 18) GENERATED ALWAYS AS (
                    CASE WHEN gets_value = 0 THEN NULL
                    ELSE pays_value / gets_value END
                  ) STORED,
    CONSTRAINT trade_fills_dedup UNIQUE (tx_hash, account, gets_currency, pays_currency)
);

CREATE INDEX IF NOT EXISTS idx_fills_ledger_index  ON trade_fills (ledger_index);
CREATE INDEX IF NOT EXISTS idx_fills_pair          ON trade_fills (gets_currency, pays_currency);
CREATE INDEX IF NOT EXISTS idx_fills_ledger_time   ON trade_fills (ledger_time);
CREATE INDEX IF NOT EXISTS idx_fills_account       ON trade_fills (account);
