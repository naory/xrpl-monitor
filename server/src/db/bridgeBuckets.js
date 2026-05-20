const UPSERT_BUCKET = `
  INSERT INTO bridge_hourly_buckets
    (hour, from_currency, from_issuer, to_currency, to_issuer,
     from_volume, to_volume, xrp_volume, event_count)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (hour, from_currency, from_issuer, to_currency, to_issuer)
  DO UPDATE SET
    from_volume  = bridge_hourly_buckets.from_volume  + EXCLUDED.from_volume,
    to_volume    = bridge_hourly_buckets.to_volume    + EXCLUDED.to_volume,
    xrp_volume   = bridge_hourly_buckets.xrp_volume   + EXCLUDED.xrp_volume,
    event_count  = bridge_hourly_buckets.event_count  + EXCLUDED.event_count
`;

async function upsertBridgeBuckets(pool, rows) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(UPSERT_BUCKET, [
        row.hour,
        row.fromCurrency,
        row.fromIssuer,
        row.toCurrency,
        row.toIssuer,
        row.fromVolume,
        row.toVolume,
        row.xrpVolume,
        row.eventCount,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

const QUERY_BUCKETS = `
  SELECT
    hour,
    from_currency AS "fromCurrency",
    from_issuer   AS "fromIssuer",
    to_currency   AS "toCurrency",
    to_issuer     AS "toIssuer",
    from_volume::text AS "fromVolume",
    to_volume::text   AS "toVolume",
    xrp_volume::text  AS "xrpVolume",
    event_count       AS "eventCount"
  FROM bridge_hourly_buckets
  WHERE hour >= $1 AND hour < $2
  ORDER BY hour ASC
`;

async function queryBridgeBuckets(pool, { from, to }) {
  const { rows } = await pool.query(QUERY_BUCKETS, [from, to]);
  return rows;
}

module.exports = { upsertBridgeBuckets, queryBridgeBuckets };
