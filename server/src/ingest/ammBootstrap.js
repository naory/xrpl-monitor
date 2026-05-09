const { upsertPool } = require('../redis/ammVolume');
const { parseCurrency, buildAmmPairKey } = require('./ammExtractor');

// Well-known high-volume AMM pools to seed on startup.
// These are fetched live via amm_info so TVL is always current.
const SEED_PAIRS = [
  // XRP / RLUSD (Ripple)
  { asset: { currency: 'XRP' }, asset2: { currency: '524C555344000000000000000000000000000000', issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De' } },
  // XRP / USD (Bitstamp)
  { asset: { currency: 'XRP' }, asset2: { currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' } },
  // XRP / USD (GateHub)
  { asset: { currency: 'XRP' }, asset2: { currency: 'USD', issuer: 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq' } },
  // XRP / EUR (GateHub)
  { asset: { currency: 'XRP' }, asset2: { currency: 'EUR', issuer: 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq' } },
  // XRP / USDC (Ripple)
  { asset: { currency: 'XRP' }, asset2: { currency: 'USD', issuer: 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu' } },
  // XRP / BTC (GateHub)
  { asset: { currency: 'XRP' }, asset2: { currency: 'BTC', issuer: 'rchGBxcD1A1C2tdxF6papQYZ8kjRKMYcL' } },
];

async function bootstrapAmmPools(xrplClient, redis) {
  let seeded = 0;
  for (const { asset, asset2 } of SEED_PAIRS) {
    try {
      const resp = await xrplClient.request({ command: 'amm_info', asset, asset2 });
      const amm = resp.result?.amm;
      if (!amm?.account) continue;

      const asset1Parsed = parseCurrency(asset);
      const asset2Parsed = parseCurrency(asset2);
      const pairKey = buildAmmPairKey(asset1Parsed, asset2Parsed);

      // TVL: amount is XRP in drops, amount2 is the token
      const xrpTvl = amm.amount ? Number(amm.amount) / 1e6 : null;
      const tokenTvl = amm.amount2?.value ? parseFloat(amm.amount2.value) : null;

      await upsertPool(redis, {
        ammAccount: amm.account,
        pairKey,
        asset1: asset1Parsed,
        asset2: asset2Parsed,
        fee: amm.trading_fee ?? 0,
        xrpTvl,
        tokenTvl,
      });
      seeded++;
    } catch (err) {
      // Pool may not exist for this pair — not an error
      if (!err.message?.includes('actNotFound') && !err.message?.includes('no current AMM')) {
        console.warn(`[AMM] Bootstrap warning for pair:`, err.message);
      }
    }
  }
  console.log(`[AMM] Bootstrapped ${seeded} pool(s)`);
}

module.exports = { bootstrapAmmPools };
