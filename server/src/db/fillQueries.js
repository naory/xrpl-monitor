const MAX_LIMIT     = 200;
const DEFAULT_LIMIT = 50;

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isFinite(d.getTime()) ? d : null;
}

function buildFillsQuery({ account, getCurrency, payCurrency, from, to, limit, cursor } = {}) {
  const params = [];
  const conditions = [];

  function param(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (cursor !== undefined && cursor !== null && cursor !== '') {
    const id = parseInt(cursor, 10);
    if (Number.isFinite(id)) conditions.push(`id < ${param(id)}`);
  }

  if (account)      conditions.push(`account = ${param(account)}`);
  if (getCurrency)  conditions.push(`gets_currency = ${param(getCurrency)}`);
  if (payCurrency)  conditions.push(`pays_currency = ${param(payCurrency)}`);

  const fromDate = parseDate(from);
  if (fromDate) conditions.push(`ledger_time >= ${param(fromDate)}`);

  const toDate = parseDate(to);
  if (toDate) conditions.push(`ledger_time <= ${param(toDate)}`);

  const limitVal = clampLimit(limit);
  const where    = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT id, ledger_index, ledger_time, tx_hash, account,
           gets_currency, gets_issuer, gets_value::text,
           pays_currency, pays_issuer, pays_value::text,
           price::text
    FROM trade_fills
    ${where}
    ORDER BY id DESC
    LIMIT ${param(limitVal)}
  `;

  return { sql, params };
}

async function getFills(pool, filters) {
  const { sql, params } = buildFillsQuery(filters);
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function getFillCount(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM trade_fills');
  return rows[0].total;
}

module.exports = { clampLimit, buildFillsQuery, getFills, getFillCount, MAX_LIMIT };
