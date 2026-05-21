const UPSERT_BUCKET = `
  INSERT INTO escrow_hourly
    (hour, type, creates, finishes, cancels,
     xrp_created, xrp_finished, xrp_cancelled,
     ttf_lt_5s, ttf_lt_30s, ttf_lt_5m, ttf_lt_1h, ttf_lt_1d, ttf_gte_1d)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  ON CONFLICT (hour, type)
  DO UPDATE SET
    creates       = escrow_hourly.creates       + EXCLUDED.creates,
    finishes      = escrow_hourly.finishes      + EXCLUDED.finishes,
    cancels       = escrow_hourly.cancels       + EXCLUDED.cancels,
    xrp_created   = escrow_hourly.xrp_created   + EXCLUDED.xrp_created,
    xrp_finished  = escrow_hourly.xrp_finished  + EXCLUDED.xrp_finished,
    xrp_cancelled = escrow_hourly.xrp_cancelled + EXCLUDED.xrp_cancelled,
    ttf_lt_5s     = escrow_hourly.ttf_lt_5s     + EXCLUDED.ttf_lt_5s,
    ttf_lt_30s    = escrow_hourly.ttf_lt_30s    + EXCLUDED.ttf_lt_30s,
    ttf_lt_5m     = escrow_hourly.ttf_lt_5m     + EXCLUDED.ttf_lt_5m,
    ttf_lt_1h     = escrow_hourly.ttf_lt_1h     + EXCLUDED.ttf_lt_1h,
    ttf_lt_1d     = escrow_hourly.ttf_lt_1d     + EXCLUDED.ttf_lt_1d,
    ttf_gte_1d    = escrow_hourly.ttf_gte_1d    + EXCLUDED.ttf_gte_1d
`;

async function upsertEscrowBuckets(pool, rows) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(UPSERT_BUCKET, [
        row.hour,       row.type,
        row.creates,    row.finishes,    row.cancels,
        row.xrpCreated, row.xrpFinished, row.xrpCancelled,
        row.ttfLt5s,    row.ttfLt30s,   row.ttfLt5m,
        row.ttfLt1h,    row.ttfLt1d,    row.ttfGte1d,
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
    type,
    creates,
    finishes,
    cancels,
    xrp_created::text   AS "xrpCreated",
    xrp_finished::text  AS "xrpFinished",
    xrp_cancelled::text AS "xrpCancelled",
    ttf_lt_5s           AS "ttfLt5s",
    ttf_lt_30s          AS "ttfLt30s",
    ttf_lt_5m           AS "ttfLt5m",
    ttf_lt_1h           AS "ttfLt1h",
    ttf_lt_1d           AS "ttfLt1d",
    ttf_gte_1d          AS "ttfGte1d"
  FROM escrow_hourly
  WHERE hour >= $1 AND hour < $2 AND type = $3
  ORDER BY hour ASC
`;

async function queryEscrowBuckets(pool, { from, to, type }) {
  const { rows } = await pool.query(QUERY_BUCKETS, [from, to, type]);
  return rows;
}

module.exports = { upsertEscrowBuckets, queryEscrowBuckets };
