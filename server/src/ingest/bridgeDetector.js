function detectBridges(fills) {
  if (!fills.length) return [];

  const sourceLegs = fills.filter(f => f.getsCurrency === 'XRP');
  const destLegs   = fills.filter(f => f.paysCurrency === 'XRP');

  if (!sourceLegs.length || !destLegs.length) return [];

  const fromCurrencies = [...new Set(sourceLegs.map(f => f.paysCurrency))];
  const toCurrencies   = [...new Set(destLegs.map(f => f.getsCurrency))];

  if (fromCurrencies.length !== 1 || toCurrencies.length !== 1) return [];

  const fromCurrency = fromCurrencies[0];
  const toCurrency   = toCurrencies[0];

  if (fromCurrency === toCurrency || fromCurrency === 'XRP' || toCurrency === 'XRP') return [];

  let xrpValue  = 0;
  let fromValue = 0;
  let toValue   = 0;

  for (const f of sourceLegs) {
    xrpValue  += parseFloat(f.getsValue)  || 0;
    fromValue += parseFloat(f.paysValue) || 0;
  }
  for (const f of destLegs) {
    toValue += parseFloat(f.getsValue) || 0;
  }

  if (xrpValue <= 0) return [];

  const fromIssuer = sourceLegs.find(f => f.paysIssuer)?.paysIssuer ?? null;
  const toIssuer   = destLegs.find(f => f.getsIssuer)?.getsIssuer   ?? null;
  const { txHash, ledgerIndex, ledgerTime } = fills[0];

  return [{
    txHash,
    ledgerIndex,
    ledgerTime,
    fromCurrency,
    fromIssuer,
    fromValue: String(fromValue),
    toCurrency,
    toIssuer,
    toValue:  String(toValue),
    xrpValue: String(xrpValue),
  }];
}

module.exports = { detectBridges };
