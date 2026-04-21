class PairRegistry {
  constructor() {
    this._map = new Map();
  }

  register(pairKey, { getsCurrency, getsIssuer, paysCurrency, paysIssuer }) {
    this._map.set(pairKey, { getsCurrency, getsIssuer, paysCurrency, paysIssuer });
  }

  get(pairKey) {
    return this._map.get(pairKey) ?? null;
  }

  size() {
    return this._map.size;
  }

  toXrplFormat(pairKey) {
    const d = this.get(pairKey);
    if (!d) return null;
    const takerGets = d.getsCurrency === 'XRP'
      ? { currency: 'XRP' }
      : { currency: d.getsCurrency, issuer: d.getsIssuer };
    const takerPays = d.paysCurrency === 'XRP'
      ? { currency: 'XRP' }
      : { currency: d.paysCurrency, issuer: d.paysIssuer };
    return { takerGets, takerPays };
  }
}

module.exports = { PairRegistry };
