/**
 * parsePairKey: 'EUR|rIssuerA~USD|rIssuerB' → { getCurrency, getIssuer, payCurrency, payIssuer }
 * Canonical order is lexicographic, so getCurrency/getIssuer is always the lex-smaller side.
 * Callers that need to know which side is "base" should use the pair key to look up trade direction.
 */
function parsePairKey(pairKey) {
  if (!pairKey || !pairKey.includes('~')) throw new Error(`malformed pairKey: ${pairKey}`);
  const [left, right] = pairKey.split('~');
  const parseSide = (side) => {
    const idx = side.indexOf('|');
    if (idx === -1) throw new Error(`malformed pairKey side: ${side}`);
    const currency = side.slice(0, idx);
    const issuer = side.slice(idx + 1) || null;
    return { currency, issuer };
  };
  const l = parseSide(left);
  const r = parseSide(right);
  return {
    getCurrency: l.currency,
    getIssuer: l.issuer,
    payCurrency: r.currency,
    payIssuer: r.issuer,
  };
}

/**
 * Build a parameterised OHLCV query for a single trading pair.
 *
 * Fills can be stored in either direction depending on which side was the
 * DeletedNode/ModifiedNode.  We union both directions so every trade is
 * represented exactly once, then compute OHLCV over (pays/gets) as the
 * canonical price expressed as "how much of the pay currency per gets unit".
 */
function buildOhlcvQuery({ getCurrency, getIssuer, payCurrency, payIssuer, bucketSeconds = 30, limit = 60 } = {}) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  // direction A: gets=getCurrency/getIssuer, pays=payCurrency/payIssuer
  // direction B: gets=payCurrency/payIssuer, pays=getCurrency/getIssuer
  const gC = p(getCurrency);
  const gI = p(getIssuer);
  const pC = p(payCurrency);
  const pI = p(payIssuer);
  const bs = p(bucketSeconds);
  const lim = p(limit);

  const sql = `
WITH fills_union AS (
  SELECT
    FLOOR(EXTRACT(EPOCH FROM ledger_time) / ${bs}) * ${bs} AS bucket_epoch,
    CAST(pays_value AS NUMERIC) / CAST(gets_value AS NUMERIC) AS price,
    CAST(gets_value AS NUMERIC) AS vol_gets,
    id
  FROM trade_fills
  WHERE
    gets_currency = ${gC}
    AND gets_issuer IS NOT DISTINCT FROM ${gI}
    AND pays_currency = ${pC}
    AND pays_issuer IS NOT DISTINCT FROM ${pI}

  UNION ALL

  SELECT
    FLOOR(EXTRACT(EPOCH FROM ledger_time) / ${bs}) * ${bs} AS bucket_epoch,
    CAST(gets_value AS NUMERIC) / CAST(pays_value AS NUMERIC) AS price,
    CAST(pays_value AS NUMERIC) AS vol_gets,
    id
  FROM trade_fills
  WHERE
    gets_currency = ${pC}
    AND gets_issuer IS NOT DISTINCT FROM ${pI}
    AND pays_currency = ${gC}
    AND pays_issuer IS NOT DISTINCT FROM ${gI}
),
buckets AS (
  SELECT
    bucket_epoch,
    to_timestamp(bucket_epoch) AS bucket_time,
    FIRST_VALUE(price) OVER (PARTITION BY bucket_epoch ORDER BY id ASC)  AS open,
    MAX(price) OVER (PARTITION BY bucket_epoch)                           AS high,
    MIN(price) OVER (PARTITION BY bucket_epoch)                           AS low,
    FIRST_VALUE(price) OVER (PARTITION BY bucket_epoch ORDER BY id DESC) AS close,
    SUM(vol_gets) OVER (PARTITION BY bucket_epoch)                       AS volume,
    COUNT(*) OVER (PARTITION BY bucket_epoch)                            AS trade_count
  FROM fills_union
)
SELECT DISTINCT
  bucket_time,
  open,
  high,
  low,
  close,
  volume,
  trade_count
FROM buckets
GROUP BY bucket_time, open, high, low, close, volume, trade_count
ORDER BY bucket_time DESC
LIMIT ${lim}
`.trim();

  return { sql, params };
}

async function getOhlcv(pool, options) {
  const { sql, params } = buildOhlcvQuery(options);
  const { rows } = await pool.query(sql, params);
  return rows;
}

module.exports = { parsePairKey, buildOhlcvQuery, getOhlcv };
