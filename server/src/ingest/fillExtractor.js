const RIPPLE_EPOCH = 946684800; // Unix seconds for 2000-01-01T00:00:00Z
const FILL_TX_TYPES = new Set(['OfferCreate', 'Payment']);

function hexToIso(hex) {
  if (hex === null || hex === undefined) return null;
  if (hex === 'XRP' || hex.length === 3) return hex;
  try {
    const ascii = Buffer.from(hex, 'hex').toString('ascii').replace(/\0+$/, '');
    if (/^[A-Za-z0-9]{3,20}$/.test(ascii)) return ascii;
  } catch (_) {}
  return hex;
}

function dropsToXrp(drops) {
  const n = BigInt(drops);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
}

function buildPairKey(gets, pays) {
  const norm = ({ currency, issuer }) => `${hexToIso(currency)}:${issuer ?? ''}`;
  const a = norm(gets);
  const b = norm(pays);
  return a < b ? `${a}/${b}` : `${b}/${a}`;
}

function parseAmount(raw) {
  if (typeof raw === 'string') {
    return { currency: 'XRP', issuer: null, value: dropsToXrp(raw) };
  }
  return {
    currency: hexToIso(raw.currency),
    issuer: raw.issuer ?? null,
    value: raw.value,
  };
}

function subtractAmounts(prev, final) {
  if (typeof prev === 'string' && typeof final === 'string') {
    return dropsToXrp(String(BigInt(prev) - BigInt(final)));
  }
  const diff = parseFloat(prev.value) - parseFloat(final.value);
  return String(parseFloat(diff.toPrecision(15)));
}

function fillFromNode(node, fillType, txHash, ledgerIndex, ledgerTime) {
  const fields = node.FinalFields;
  if (!fields?.Account || !fields?.TakerGets || !fields?.TakerPays) return null;

  let getsRaw, paysRaw;

  if (fillType === 'partial') {
    const prev = node.PreviousFields;
    if (!prev?.TakerGets || !prev?.TakerPays) return null;
    getsRaw = { value: subtractAmounts(prev.TakerGets, fields.TakerGets), raw: prev.TakerGets };
    paysRaw = { value: subtractAmounts(prev.TakerPays, fields.TakerPays), raw: prev.TakerPays };
  } else {
    getsRaw = { value: null, raw: fields.TakerGets };
    paysRaw = { value: null, raw: fields.TakerPays };
  }

  const gets = parseAmount(getsRaw.raw);
  const pays = parseAmount(paysRaw.raw);

  if (fillType === 'partial') {
    gets.value = getsRaw.value;
    pays.value = paysRaw.value;
  }

  return {
    txHash,
    ledgerIndex,
    ledgerTime,
    account: fields.Account,
    getsCurrency: gets.currency,
    getsIssuer: gets.issuer,
    getsValue: gets.value,
    paysCurrency: pays.currency,
    paysIssuer: pays.issuer,
    paysValue: pays.value,
    pairKey: buildPairKey(gets, pays),
    fillType,
  };
}

function extractFills(event) {
  if (!event?.validated) return [];
  if (event.meta?.TransactionResult !== 'tesSUCCESS') return [];
  if (!FILL_TX_TYPES.has(event.transaction?.TransactionType)) return [];

  const txHash = event.transaction.hash;
  const ledgerIndex = event.ledger_index;
  const ledgerTime = new Date((event.transaction.date + RIPPLE_EPOCH) * 1000);
  const fills = [];

  for (const node of event.meta?.AffectedNodes ?? []) {
    if (node.DeletedNode?.LedgerEntryType === 'Offer') {
      const fill = fillFromNode(node.DeletedNode, 'full', txHash, ledgerIndex, ledgerTime);
      if (fill) fills.push(fill);
    } else if (node.ModifiedNode?.LedgerEntryType === 'Offer') {
      const fill = fillFromNode(node.ModifiedNode, 'partial', txHash, ledgerIndex, ledgerTime);
      if (fill) fills.push(fill);
    }
  }

  return fills;
}

module.exports = { extractFills, buildPairKey, dropsToXrp, hexToIso };
