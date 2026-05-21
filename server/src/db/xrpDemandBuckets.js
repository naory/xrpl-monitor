const UPSERT_BUCKET = `
  INSERT INTO xrp_demand_hourly
    (hour, currency, xrp_bought, xrp_sold, event_count)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (hour, currency)
  DO UPDATE SET
    xrp_bought  = xrp_demand_hourly.xrp_bought  + EXCLUDED.xrp_bought,
    xrp_sold    = xrp_demand_hourly.xrp_sold    + EXCLUDED.xrp_sold,
    event_count = xrp_demand_hourly.event_count + EXCLUDED.event_count
`;

async function upsertXrpDemandBuckets(pool, rows) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(UPSERT_BUCKET, [
        row.hour,
        row.currency,
        row.xrpBought,
        row.xrpSold,
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
    currency,
    xrp_bought::text  AS "xrpBought",
    xrp_sold::text    AS "xrpSold",
    event_count       AS "eventCount"
  FROM xrp_demand_hourly
  WHERE hour >= $1 AND hour < $2
  ORDER BY hour ASC
`;

async function queryXrpDemandBuckets(pool, { from, to }) {
  const { rows } = await pool.query(QUERY_BUCKETS, [from, to]);
  return rows;
}

module.exports = { upsertXrpDemandBuckets, queryXrpDemandBuckets };
