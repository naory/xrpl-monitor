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

CREATE TABLE IF NOT EXISTS bridge_hourly_buckets (
    hour          TIMESTAMP NOT NULL,
    from_currency VARCHAR(64) NOT NULL,
    from_issuer   VARCHAR(64) NOT NULL DEFAULT '',
    to_currency   VARCHAR(64) NOT NULL,
    to_issuer     VARCHAR(64) NOT NULL DEFAULT '',
    from_volume   NUMERIC(38, 18) NOT NULL DEFAULT 0,
    to_volume     NUMERIC(38, 18) NOT NULL DEFAULT 0,
    xrp_volume    NUMERIC(38, 18) NOT NULL DEFAULT 0,
    event_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, from_currency, from_issuer, to_currency, to_issuer)
);
CREATE INDEX IF NOT EXISTS idx_bridge_buckets_hour ON bridge_hourly_buckets (hour);

CREATE TABLE IF NOT EXISTS xrp_demand_hourly (
    hour        TIMESTAMP NOT NULL,
    currency    VARCHAR(64) NOT NULL,
    xrp_bought  NUMERIC(38,18) NOT NULL DEFAULT 0,
    xrp_sold    NUMERIC(38,18) NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, currency)
);
CREATE INDEX IF NOT EXISTS idx_xrp_demand_hour ON xrp_demand_hourly (hour);

CREATE TABLE IF NOT EXISTS escrow_hourly (
    hour          TIMESTAMP NOT NULL,
    type          VARCHAR(16) NOT NULL,
    creates       INTEGER NOT NULL DEFAULT 0,
    finishes      INTEGER NOT NULL DEFAULT 0,
    cancels       INTEGER NOT NULL DEFAULT 0,
    xrp_created   NUMERIC(38,18) NOT NULL DEFAULT 0,
    xrp_finished  NUMERIC(38,18) NOT NULL DEFAULT 0,
    xrp_cancelled NUMERIC(38,18) NOT NULL DEFAULT 0,
    ttf_lt_5s     INTEGER NOT NULL DEFAULT 0,
    ttf_lt_30s    INTEGER NOT NULL DEFAULT 0,
    ttf_lt_5m     INTEGER NOT NULL DEFAULT 0,
    ttf_lt_1h     INTEGER NOT NULL DEFAULT 0,
    ttf_lt_1d     INTEGER NOT NULL DEFAULT 0,
    ttf_gte_1d    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, type)
);
CREATE INDEX IF NOT EXISTS idx_escrow_hourly_hour ON escrow_hourly (hour);
