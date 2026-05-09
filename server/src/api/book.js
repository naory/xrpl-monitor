const express = require('express');
const { buildPairKey } = require('../ingest/fillExtractor');
const { getOrderBook } = require('../redis/orderbook');

// Parse pairKey into two XRPL-format currency objects.
// pairKey = "LEFT|issuer~RIGHT|issuer"
function pairKeyToXrpl(pairKey) {
  const [left, right] = pairKey.split('~');
  const toXrpl = (side) => {
    const [currency, issuer] = side.split('|');
    return currency === 'XRP' ? { currency: 'XRP' } : { currency, issuer };
  };
  return { left: toXrpl(left), right: toXrpl(right) };
}

function createBookRouter({ redis, xrplClient, pairRegistry }) {
  const router = express.Router();

  // GET /book?pairKey=USD|issuer~XRP|
  // Also accepts legacy: GET /book?getsCurrency=XRP&paysCurrency=USD&paysIssuer=rXXX
  router.get('/', async (req, res) => {
    let pairKey;

    if (req.query.pairKey) {
      pairKey = req.query.pairKey;
    } else {
      const { getsCurrency, getsIssuer, paysCurrency, paysIssuer } = req.query;
      if (!getsCurrency || !paysCurrency) {
        return res.status(400).json({ error: 'pairKey or getsCurrency+paysCurrency are required' });
      }
      pairKey = buildPairKey(
        { currency: getsCurrency, issuer: getsIssuer ?? null },
        { currency: paysCurrency, issuer: paysIssuer ?? null },
      );
    }

    // Serve from Redis cache first
    try {
      const cached = await getOrderBook(redis, pairKey);
      if (cached) return res.json({ source: 'cache', pairKey, ...cached });
    } catch (err) {
      console.error('[BOOK] Redis cache read failed:', err.message);
    }

    if (!xrplClient.isConnected()) {
      return res.status(503).json({ error: 'XRPL not connected' });
    }

    // Cache miss — fetch both sides of the book directly from pairKey
    try {
      const { left, right } = pairKeyToXrpl(pairKey);

      // bids: offers where taker gets left-side (e.g. USD), pays right-side (XRP)
      // asks: offers where taker gets right-side (XRP), pays left-side (USD)
      const [bids, asks] = await Promise.all([
        xrplClient.requestOrderBook(left, right),
        xrplClient.requestOrderBook(right, left),
      ]);

      return res.json({ source: 'live', pairKey, bids, asks });
    } catch (err) {
      console.error('[BOOK] Live XRPL request failed:', err.message);
      return res.status(502).json({ error: 'Failed to fetch order book from XRPL' });
    }
  });

  return router;
}

module.exports = { createBookRouter };
