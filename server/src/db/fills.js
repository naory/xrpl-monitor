const INSERT_FILL = `
  INSERT INTO trade_fills (
    ledger_index, ledger_time, tx_hash, account,
    gets_currency, gets_issuer, gets_value,
    pays_currency, pays_issuer, pays_value
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  ON CONFLICT (tx_hash, account, gets_currency, pays_currency) DO NOTHING
`;

async function writeFills(pool, fills) {
  if (!fills.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of fills) {
      await client.query(INSERT_FILL, [
        f.ledgerIndex,
        f.ledgerTime,
        f.txHash,
        f.account,
        f.getsCurrency,
        f.getsIssuer,
        f.getsValue,
        f.paysCurrency,
        f.paysIssuer,
        f.paysValue,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getLastLedgerIndex(pool) {
  const { rows } = await pool.query('SELECT MAX(ledger_index) AS last FROM trade_fills');
  return rows[0].last ? Number(rows[0].last) : null;
}

module.exports = { writeFills, getLastLedgerIndex };
