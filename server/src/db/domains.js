function decodeCredentialType(hex) {
  try {
    const str = Buffer.from(hex, 'hex').toString('utf8');
    if (/^[\x20-\x7E]+$/.test(str)) return str;
  } catch {}
  return hex;
}

function normaliseCredentials(raw) {
  return (raw ?? []).map((c) => ({
    issuer:      c.Credential.Issuer,
    type:        c.Credential.CredentialType,
    typeDecoded: decodeCredentialType(c.Credential.CredentialType),
  }));
}

async function upsertDomain(pool, network, obj) {
  const credentials = normaliseCredentials(obj.AcceptedCredentials);
  await pool.query(`
    INSERT INTO permissioned_domains (index, network, owner, sequence, credentials, prev_txn_id, crawled_at)
    VALUES ($1,$2,$3,$4,$5,$6,NOW())
    ON CONFLICT (index, network) DO UPDATE SET
      owner       = EXCLUDED.owner,
      sequence    = EXCLUDED.sequence,
      credentials = EXCLUDED.credentials,
      prev_txn_id = EXCLUDED.prev_txn_id,
      crawled_at  = NOW()
  `, [obj.index, network, obj.Owner, obj.Sequence, JSON.stringify(credentials), obj.PreviousTxnID ?? null]);
}

async function deleteDomain(pool, network, index) {
  await pool.query('DELETE FROM permissioned_domains WHERE index=$1 AND network=$2', [index, network]);
}

async function upsertDexOffer(pool, network, obj) {
  await pool.query(`
    INSERT INTO permissioned_dex (index, network, account, domain_id, taker_gets, taker_pays, flags, sequence, prev_txn_id, crawled_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (index, network) DO UPDATE SET
      account     = EXCLUDED.account,
      domain_id   = EXCLUDED.domain_id,
      taker_gets  = EXCLUDED.taker_gets,
      taker_pays  = EXCLUDED.taker_pays,
      flags       = EXCLUDED.flags,
      sequence    = EXCLUDED.sequence,
      prev_txn_id = EXCLUDED.prev_txn_id,
      crawled_at  = NOW()
  `, [obj.index, network, obj.Account, obj.DomainID,
      JSON.stringify(obj.TakerGets), JSON.stringify(obj.TakerPays),
      obj.Flags ?? null, obj.Sequence ?? null, obj.PreviousTxnID ?? null]);
}

async function deleteDexOffer(pool, network, index) {
  await pool.query('DELETE FROM permissioned_dex WHERE index=$1 AND network=$2', [index, network]);
}

async function searchDomains(pool, network, { search = '', limit = 50, offset = 0 } = {}) {
  const like = search ? `%${search.toLowerCase()}%` : null;
  const { rows } = await pool.query(`
    SELECT d.index, d.network, d.owner, d.sequence, d.credentials, d.prev_txn_id, d.crawled_at,
           COUNT(p.index)::int AS offer_count
    FROM permissioned_domains d
    LEFT JOIN permissioned_dex p ON p.domain_id = d.index AND p.network = d.network
    WHERE d.network = $1
      AND ($2::text IS NULL OR LOWER(d.owner) LIKE $2 OR d.credentials::text ILIKE $2)
    GROUP BY d.index, d.network
    ORDER BY d.crawled_at DESC
    LIMIT $3 OFFSET $4
  `, [network, like, limit, offset]);

  const { rows: [{ total }] } = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM permissioned_domains
    WHERE network = $1
      AND ($2::text IS NULL OR LOWER(owner) LIKE $2 OR credentials::text ILIKE $2)
  `, [network, like]);

  return { domains: rows, total, network };
}

async function getDomainById(pool, network, index) {
  const { rows: [domain] } = await pool.query(
    'SELECT * FROM permissioned_domains WHERE index=$1 AND network=$2',
    [index, network]
  );
  if (!domain) return null;
  const { rows: offers } = await pool.query(
    'SELECT * FROM permissioned_dex WHERE domain_id=$1 AND network=$2 ORDER BY crawled_at DESC',
    [index, network]
  );
  return { ...domain, offers };
}

async function getDexOffers(pool, network, { search = '', limit = 100, offset = 0 } = {}) {
  const like = search ? `%${search.toLowerCase()}%` : null;
  const { rows } = await pool.query(`
    SELECT p.*, d.owner AS domain_owner, d.credentials AS domain_credentials
    FROM permissioned_dex p
    LEFT JOIN permissioned_domains d ON d.index = p.domain_id AND d.network = p.network
    WHERE p.network = $1
      AND ($2::text IS NULL OR LOWER(p.account) LIKE $2 OR LOWER(p.domain_id) LIKE $2)
    ORDER BY p.crawled_at DESC
    LIMIT $3 OFFSET $4
  `, [network, like, limit, offset]);
  const { rows: [{ total }] } = await pool.query(`
    SELECT COUNT(*)::int AS total FROM permissioned_dex
    WHERE network=$1 AND ($2::text IS NULL OR LOWER(account) LIKE $2 OR LOWER(domain_id) LIKE $2)
  `, [network, like]);
  return { offers: rows, total, network };
}

module.exports = { upsertDomain, deleteDomain, upsertDexOffer, deleteDexOffer, searchDomains, getDomainById, getDexOffers };
