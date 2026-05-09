const RIPPLE_EPOCH = 946684800;
const DROPS_PER_XRP = 1_000_000n;

function dropsToXrp(drops) {
  const n = BigInt(drops);
  const whole = n / DROPS_PER_XRP;
  const frac = (n % DROPS_PER_XRP).toString().padStart(6, '0');
  return `${whole}.${frac}`;
}

function hexToIso(hex) {
  const trimmed = hex.replace(/0+$/, '');
  try {
    return Buffer.from(trimmed, 'hex').toString('ascii').replace(/\0/g, '');
  } catch {
    return hex;
  }
}

function parseCurrency(asset) {
  if (!asset) return null;
  if (asset.currency === 'XRP' && !asset.issuer) return { currency: 'XRP', issuer: null };
  let currency = asset.currency;
  if (/^[0-9A-Fa-f]{40}$/.test(currency)) currency = hexToIso(currency);
  return { currency, issuer: asset.issuer ?? null };
}

function buildAmmPairKey(asset1, asset2) {
  const fmt = (a) => `${a.currency}|${a.issuer ?? ''}`;
  const a = fmt(asset1);
  const b = fmt(asset2);
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

// Returns XRP delta from the AMM account's perspective (positive = AMM received XRP).
function xrpDeltaForAccount(nodes, ammAccount) {
  for (const node of nodes) {
    const mn = node.ModifiedNode;
    if (!mn || mn.LedgerEntryType !== 'AccountRoot') continue;
    if (mn.FinalFields?.Account !== ammAccount) continue;
    const prev = mn.PreviousFields?.Balance;
    const final = mn.FinalFields?.Balance;
    if (prev == null || final == null) continue;
    return Number(BigInt(final) - BigInt(prev));
  }
  return null;
}

// Returns token delta from the AMM account's perspective (positive = AMM received token).
function tokenDeltaForAccount(nodes, ammAccount, lpCurrency) {
  for (const node of nodes) {
    const mn = node.ModifiedNode;
    if (!mn || mn.LedgerEntryType !== 'RippleState') continue;
    const ff = mn.FinalFields ?? {};
    const bal = ff.Balance ?? {};
    if (bal.currency === lpCurrency) continue; // skip LP token lines

    const hiAccount = ff.HighLimit?.issuer;
    const loAccount = ff.LowLimit?.issuer;
    if (hiAccount !== ammAccount && loAccount !== ammAccount) continue;

    const prevVal = mn.PreviousFields?.Balance?.value;
    const finalVal = bal.value;
    if (prevVal == null || finalVal == null) continue;

    // RippleState.Balance is from the low-account's perspective.
    // positive Balance = low account holds tokens.
    const delta = parseFloat(finalVal) - parseFloat(prevVal);
    // Flip sign if AMM is the high account (balance is from *low* account's view).
    return hiAccount === ammAccount ? -delta : delta;
  }
  return null;
}

function classifyEvent(xrpDelta, tokenDelta) {
  if (xrpDelta === null && tokenDelta === null) return 'unknown';
  // One side null means single-asset deposit/withdraw — treat as liquidity event.
  if (xrpDelta === null || tokenDelta === null) return 'liquidity';
  // Same sign → both sides moved in the same direction → deposit or withdrawal.
  if ((xrpDelta >= 0) === (tokenDelta >= 0)) return 'liquidity';
  // Opposite signs → one side went in, the other came out → swap.
  return 'swap';
}

/**
 * Extract AMM events (swaps and liquidity changes) from a validated transaction.
 * Returns an array of event objects.
 */
function extractAmmEvents(event) {
  if (!event?.validated) return [];
  if (event.meta?.TransactionResult !== 'tesSUCCESS') return [];

  const nodes = event.meta?.AffectedNodes ?? [];
  const txHash    = event.hash;
  const ledgerIndex = event.ledger_index;
  const ledgerTime  = event.tx_json?.date != null
    ? new Date((event.tx_json.date + RIPPLE_EPOCH) * 1000)
    : null;

  const events = [];

  for (const node of nodes) {
    // AMM node created → new pool discovered.
    if (node.CreatedNode?.LedgerEntryType === 'AMM') {
      const nf = node.CreatedNode.NewFields ?? {};
      const asset1 = parseCurrency(nf.Asset);
      const asset2 = parseCurrency(nf.Asset2);
      if (!asset1 || !asset2) continue;
      events.push({
        type: 'create',
        ammAccount: nf.Account,
        pairKey: buildAmmPairKey(asset1, asset2),
        asset1, asset2,
        fee: nf.TradingFee ?? 0,
        txHash, ledgerIndex, ledgerTime,
      });
      continue;
    }

    // AMM node modified → swap or deposit/withdraw.
    if (node.ModifiedNode?.LedgerEntryType !== 'AMM') continue;
    const mn = node.ModifiedNode;
    const ff = mn.FinalFields ?? {};
    const ammAccount = ff.Account;
    if (!ammAccount) continue;

    const asset1 = parseCurrency(ff.Asset);
    const asset2 = parseCurrency(ff.Asset2);
    if (!asset1 || !asset2) continue;

    const lpCurrency = ff.LPTokenBalance?.currency;
    const fee = ff.TradingFee ?? 0;
    const pairKey = buildAmmPairKey(asset1, asset2);

    // XRP/token pool: one side is XRP.
    const xrpSide   = asset1.currency === 'XRP' ? asset1 : asset2.currency === 'XRP' ? asset2 : null;
    const tokenSide = xrpSide === asset1 ? asset2 : asset1;

    const xrpDelta   = xrpSide ? xrpDeltaForAccount(nodes, ammAccount) : null;
    const tokenDelta = tokenDeltaForAccount(nodes, ammAccount, lpCurrency);

    const eventType = classifyEvent(xrpDelta, tokenDelta);

    // XRP volume = absolute XRP amount exchanged.
    const xrpVolume = xrpDelta !== null ? Math.abs(xrpDelta) / 1e6 : null;

    // Effective price: token per XRP (positive regardless of direction).
    let price = null;
    if (xrpDelta && tokenDelta && xrpDelta !== 0) {
      price = Math.abs(tokenDelta) / Math.abs(xrpDelta / 1e6);
    }

    events.push({
      type: eventType,         // 'swap' | 'liquidity' | 'unknown'
      ammAccount,
      pairKey,
      asset1, asset2,
      fee,
      xrpDelta: xrpDelta !== null ? xrpDelta / 1e6 : null,
      tokenDelta,
      xrpVolume,               // always positive, XRP units
      price,                   // token per XRP
      txHash, ledgerIndex, ledgerTime,
    });
  }

  return events;
}

module.exports = { extractAmmEvents, buildAmmPairKey, parseCurrency };
