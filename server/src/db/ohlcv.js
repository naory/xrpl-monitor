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
 * Volume is always expressed in the XRP side of the pair so values are
 * comparable across windows.  For token/token pairs, getsValue is used.
 *
 * Price is canonical: pays/gets for direction-A fills, gets/pays for
 * direction-B fills, both yielding "payCurrency per getCurrency unit".
 */
function buildOhlcvQuery({ getCurrency, getIssuer, payCurrency, payIssuer, bucketSeconds = 30, limit = 60, from } = {}) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  const gC = p(getCurrency);
  const gI = p(getIssuer);
  const pC = p(payCurrency);
  const pI = p(payIssuer);
  const bs = p(bucketSeconds);
  const lim = p(limit);

  // Determine which column holds XRP volume at query-build time.
  // Direction A: gets=getCurrency, pays=payCurrency
  //   XRP is gets → gets_value; XRP is pays → pays_value; neither → gets_value
  const volA = getCurrency === 'XRP' ? 'CAST(gets_value AS NUMERIC)'
             : payCurrency === 'XRP' ? 'CAST(pays_value AS NUMERIC)'
             : 'CAST(gets_value AS NUMERIC)';

  // Direction B: gets=payCurrency, pays=getCurrency
  //   XRP is payCurrency (now gets) → gets_value; XRP is getCurrency (now pays) → pays_value
  const volB = payCurrency === 'XRP' ? 'CAST(gets_value AS NUMERIC)'
             : getCurrency === 'XRP' ? 'CAST(pays_value AS NUMERIC)'
             : 'CAST(gets_value AS NUMERIC)';

  const fromClause = from ? `AND ledger_time >= ${p(from)}` : '';

  const sql = `
WITH fills_union AS (
  SELECT
    FLOOR(EXTRACT(EPOCH FROM ledger_time) / ${bs}) * ${bs} AS bucket_epoch,
    CAST(pays_value AS NUMERIC) / NULLIF(CAST(gets_value AS NUMERIC), 0) AS price,
    ${volA} AS xrp_vol,
    id
  FROM trade_fills
  WHERE
    gets_currency = ${gC}
    AND gets_issuer IS NOT DISTINCT FROM ${gI}
    AND pays_currency = ${pC}
    AND pays_issuer IS NOT DISTINCT FROM ${pI}
    AND gets_value > 0 AND pays_value > 0
    ${fromClause}

  UNION ALL

  SELECT
    FLOOR(EXTRACT(EPOCH FROM ledger_time) / ${bs}) * ${bs} AS bucket_epoch,
    CAST(gets_value AS NUMERIC) / NULLIF(CAST(pays_value AS NUMERIC), 0) AS price,
    ${volB} AS xrp_vol,
    id
  FROM trade_fills
  WHERE
    gets_currency = ${pC}
    AND gets_issuer IS NOT DISTINCT FROM ${pI}
    AND pays_currency = ${gC}
    AND pays_issuer IS NOT DISTINCT FROM ${gI}
    AND gets_value > 0 AND pays_value > 0
    ${fromClause}
),
buckets AS (
  SELECT
    bucket_epoch,
    to_timestamp(bucket_epoch) AS bucket_time,
    FIRST_VALUE(price) OVER (PARTITION BY bucket_epoch ORDER BY id ASC)  AS open,
    MAX(price) OVER (PARTITION BY bucket_epoch)                           AS high,
    MIN(price) OVER (PARTITION BY bucket_epoch)                           AS low,
    FIRST_VALUE(price) OVER (PARTITION BY bucket_epoch ORDER BY id DESC) AS close,
    SUM(xrp_vol) OVER (PARTITION BY bucket_epoch)                        AS volume,
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
