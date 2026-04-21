const { extractFills, buildPairKey, dropsToXrp, hexToIso } = require('../../src/ingest/fillExtractor');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RIPPLE_EPOCH = 946684800; // Unix seconds for 2000-01-01T00:00:00Z

function makeEvent({ txType = 'OfferCreate', result = 'tesSUCCESS', nodes = [], date = 800000000 } = {}) {
  return {
    type: 'transaction',
    validated: true,
    ledger_index: 90000000,
    transaction: {
      TransactionType: txType,
      Account: 'rSubmitter111',
      hash: 'DEADBEEF01',
      date,
    },
    meta: {
      TransactionResult: result,
      AffectedNodes: nodes,
    },
  };
}

function deletedOffer({ account = 'rMaker111', gets, pays }) {
  return {
    DeletedNode: {
      LedgerEntryType: 'Offer',
      FinalFields: { Account: account, TakerGets: gets, TakerPays: pays },
    },
  };
}

function modifiedOffer({ account = 'rMaker222', gets, pays, prevGets, prevPays }) {
  return {
    ModifiedNode: {
      LedgerEntryType: 'Offer',
      FinalFields: { Account: account, TakerGets: gets, TakerPays: pays },
      PreviousFields: { TakerGets: prevGets, TakerPays: prevPays },
    },
  };
}

const XRP_DROPS = '5000000'; // 5 XRP
const USD_AMT = { currency: 'USD', issuer: 'rIssuer1', value: '10' };

// ---------------------------------------------------------------------------
// hexToIso
// ---------------------------------------------------------------------------

describe('hexToIso', () => {
  it('returns XRP unchanged', () => {
    expect(hexToIso('XRP')).toBe('XRP');
  });

  it('returns 3-char ISO codes unchanged', () => {
    expect(hexToIso('USD')).toBe('USD');
    expect(hexToIso('EUR')).toBe('EUR');
  });

  it('converts a 40-char hex currency code to ASCII', () => {
    // 'USD' in hex padded to 40 chars
    const hex = '5553440000000000000000000000000000000000';
    expect(hexToIso(hex)).toBe('USD');
  });

  it('returns the original hex if it does not decode to printable ASCII', () => {
    const nonPrintable = 'FF00000000000000000000000000000000000000';
    expect(hexToIso(nonPrintable)).toBe(nonPrintable);
  });

  it('returns empty string for null/undefined', () => {
    expect(hexToIso(null)).toBeNull();
    expect(hexToIso(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dropsToXrp
// ---------------------------------------------------------------------------

describe('dropsToXrp', () => {
  it('converts drops string to XRP decimal string', () => {
    expect(dropsToXrp('1000000')).toBe('1.000000');
    expect(dropsToXrp('5000000')).toBe('5.000000');
    expect(dropsToXrp('1')).toBe('0.000001');
    expect(dropsToXrp('1500000')).toBe('1.500000');
  });

  it('handles zero', () => {
    expect(dropsToXrp('0')).toBe('0.000000');
  });
});

// ---------------------------------------------------------------------------
// buildPairKey
// ---------------------------------------------------------------------------

describe('buildPairKey', () => {
  it('produces a stable key regardless of gets/pays order', () => {
    const a = buildPairKey(
      { currency: 'XRP', issuer: null },
      { currency: 'USD', issuer: 'rIssuer1' }
    );
    const b = buildPairKey(
      { currency: 'USD', issuer: 'rIssuer1' },
      { currency: 'XRP', issuer: null }
    );
    expect(a).toBe(b);
  });

  it('distinguishes pairs with the same currencies but different issuers', () => {
    const a = buildPairKey(
      { currency: 'USD', issuer: 'rIssuerA' },
      { currency: 'XRP', issuer: null }
    );
    const b = buildPairKey(
      { currency: 'USD', issuer: 'rIssuerB' },
      { currency: 'XRP', issuer: null }
    );
    expect(a).not.toBe(b);
  });

  it('normalises hex currency codes before keying', () => {
    const hex = '5553440000000000000000000000000000000000';
    const a = buildPairKey({ currency: hex, issuer: 'rIssuer1' }, { currency: 'XRP', issuer: null });
    const b = buildPairKey({ currency: 'USD', issuer: 'rIssuer1' }, { currency: 'XRP', issuer: null });
    expect(a).toBe(b);
  });

  it('uses a separator that cannot appear in currency codes or issuer addresses', () => {
    const key = buildPairKey(
      { currency: 'USD', issuer: 'rIssuer1' },
      { currency: 'XRP', issuer: null }
    );
    // Key must contain | as field separator and ~ as pair separator — not /
    expect(key).toContain('|');
    expect(key).toContain('~');
    expect(key).not.toContain('/');
  });
});

// ---------------------------------------------------------------------------
// extractFills — guard conditions
// ---------------------------------------------------------------------------

describe('extractFills — guard conditions', () => {
  it('returns empty array for a failed transaction', () => {
    const ev = makeEvent({ result: 'tecUNFUNDED_OFFER' });
    expect(extractFills(ev)).toEqual([]);
  });

  it('returns empty array when no offer nodes are affected', () => {
    const ev = makeEvent({
      nodes: [{ ModifiedNode: { LedgerEntryType: 'AccountRoot', FinalFields: {} } }],
    });
    expect(extractFills(ev)).toEqual([]);
  });

  it('returns empty array for a non-offer transaction type with no fills', () => {
    const ev = makeEvent({ txType: 'EscrowCreate' });
    expect(extractFills(ev)).toEqual([]);
  });

  it('returns empty array for null/undefined input', () => {
    expect(extractFills(null)).toEqual([]);
    expect(extractFills(undefined)).toEqual([]);
  });

  it('ignores unvalidated transactions', () => {
    const ev = { ...makeEvent(), validated: false };
    expect(extractFills(ev)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFills — full fill (DeletedNode)
// ---------------------------------------------------------------------------

describe('extractFills — full fill (DeletedNode)', () => {
  it('extracts one fill from a fully consumed token/XRP offer', () => {
    const ev = makeEvent({
      nodes: [deletedOffer({ gets: USD_AMT, pays: XRP_DROPS })],
    });
    const fills = extractFills(ev);
    expect(fills).toHaveLength(1);
    const f = fills[0];
    expect(f.txHash).toBe('DEADBEEF01');
    expect(f.ledgerIndex).toBe(90000000);
    expect(f.account).toBe('rMaker111');
    expect(f.getsCurrency).toBe('USD');
    expect(f.getsIssuer).toBe('rIssuer1');
    expect(f.getsValue).toBe('10');
    expect(f.paysCurrency).toBe('XRP');
    expect(f.paysIssuer).toBeNull();
    expect(f.paysValue).toBe('5.000000');
    expect(f.fillType).toBe('full');
    expect(f.ledgerTime).toBeInstanceOf(Date);
  });

  it('extracts one fill from a fully consumed XRP/token offer', () => {
    const ev = makeEvent({
      nodes: [deletedOffer({ gets: XRP_DROPS, pays: USD_AMT })],
    });
    const fills = extractFills(ev);
    expect(fills).toHaveLength(1);
    expect(fills[0].getsCurrency).toBe('XRP');
    expect(fills[0].getsValue).toBe('5.000000');
    expect(fills[0].paysCurrency).toBe('USD');
    expect(fills[0].paysValue).toBe('10');
  });
});

// ---------------------------------------------------------------------------
// extractFills — partial fill (ModifiedNode)
// ---------------------------------------------------------------------------

describe('extractFills — partial fill (ModifiedNode)', () => {
  it('extracts fill amount as the difference between previous and final fields', () => {
    const ev = makeEvent({
      nodes: [
        modifiedOffer({
          gets: { currency: 'USD', issuer: 'rIssuer1', value: '40' },   // remaining after fill
          pays: '3000000',                                                 // remaining
          prevGets: { currency: 'USD', issuer: 'rIssuer1', value: '100' }, // before fill
          prevPays: '5000000',
        }),
      ],
    });
    const fills = extractFills(ev);
    expect(fills).toHaveLength(1);
    const f = fills[0];
    expect(f.fillType).toBe('partial');
    expect(f.getsValue).toBe('60');     // 100 - 40
    expect(f.paysValue).toBe('2.000000'); // (5000000 - 3000000) drops → XRP
  });

  it('handles token/token partial fill correctly (no XRP drops)', () => {
    const ev = makeEvent({
      nodes: [
        modifiedOffer({
          gets: { currency: 'USD', issuer: 'rIssuerA', value: '40' },
          pays: { currency: 'EUR', issuer: 'rIssuerB', value: '36' },
          prevGets: { currency: 'USD', issuer: 'rIssuerA', value: '100' },
          prevPays: { currency: 'EUR', issuer: 'rIssuerB', value: '90' },
        }),
      ],
    });
    const fills = extractFills(ev);
    expect(fills).toHaveLength(1);
    expect(fills[0].getsCurrency).toBe('USD');
    expect(fills[0].paysCurrency).toBe('EUR');
    expect(parseFloat(fills[0].getsValue)).toBeCloseTo(60);  // 100 - 40
    expect(parseFloat(fills[0].paysValue)).toBeCloseTo(54);  // 90 - 36
    expect(fills[0].fillType).toBe('partial');
  });

  it('ignores ModifiedNode offers with no PreviousFields', () => {
    const ev = makeEvent({
      nodes: [
        {
          ModifiedNode: {
            LedgerEntryType: 'Offer',
            FinalFields: { Account: 'rMaker', TakerGets: USD_AMT, TakerPays: XRP_DROPS },
            // no PreviousFields
          },
        },
      ],
    });
    expect(extractFills(ev)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFills — multiple fills in one transaction
// ---------------------------------------------------------------------------

describe('extractFills — multiple fills in one transaction', () => {
  it('extracts all offer nodes from one transaction', () => {
    const ev = makeEvent({
      nodes: [
        deletedOffer({ account: 'rMakerA', gets: USD_AMT, pays: XRP_DROPS }),
        modifiedOffer({
          account: 'rMakerB',
          gets: { currency: 'USD', issuer: 'rIssuer1', value: '5' },
          pays: '500000',
          prevGets: { currency: 'USD', issuer: 'rIssuer1', value: '20' },
          prevPays: '2000000',
        }),
      ],
    });
    const fills = extractFills(ev);
    expect(fills).toHaveLength(2);
    expect(fills[0].account).toBe('rMakerA');
    expect(fills[0].fillType).toBe('full');
    expect(fills[1].account).toBe('rMakerB');
    expect(fills[1].fillType).toBe('partial');
    expect(fills[1].getsValue).toBe('15'); // 20 - 5
  });
});

// ---------------------------------------------------------------------------
// extractFills — ledger time
// ---------------------------------------------------------------------------

describe('extractFills — ledger time', () => {
  it('converts Ripple epoch date to JS Date correctly', () => {
    const rippleDate = 800000000;
    const expectedUnixMs = (rippleDate + RIPPLE_EPOCH) * 1000;
    const ev = makeEvent({
      nodes: [deletedOffer({ gets: USD_AMT, pays: XRP_DROPS })],
      date: rippleDate,
    });
    const fills = extractFills(ev);
    expect(fills[0].ledgerTime.getTime()).toBe(expectedUnixMs);
  });
});

// ---------------------------------------------------------------------------
// extractFills — Payment transaction type
// ---------------------------------------------------------------------------

describe('extractFills — Payment transaction', () => {
  it('also extracts fills from Payment transactions that consume offers', () => {
    const ev = makeEvent({
      txType: 'Payment',
      nodes: [deletedOffer({ gets: USD_AMT, pays: XRP_DROPS })],
    });
    const fills = extractFills(ev);
    expect(fills).toHaveLength(1);
  });
});
