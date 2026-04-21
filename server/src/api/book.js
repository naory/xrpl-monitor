const express = require('express');
const { buildPairKey } = require('../ingest/fillExtractor');
const { getOrderBook } = require('../redis/orderbook');

function createBookRouter({ redis, xrplClient, pairRegistry }) {
  const router = express.Router();

  // GET /book?getsCurrency=XRP&paysCurrency=USD&paysIssuer=rXXX
  router.get('/', async (req, res) => {
    const { getsCurrency, getsIssuer, paysCurrency, paysIssuer } = req.query;

    if (!getsCurrency || !paysCurrency) {
      return res.status(400).json({ error: 'getsCurrency and paysCurrency are required' });
    }

    const pairKey = buildPairKey(
      { currency: getsCurrency, issuer: getsIssuer ?? null },
      { currency: paysCurrency, issuer: paysIssuer ?? null },
    );

    // Serve from Redis cache first
    try {
      const cached = await getOrderBook(redis, pairKey);
      if (cached) return res.json({ source: 'cache', pairKey, ...cached });
    } catch (err) {
      console.error('[BOOK] Redis cache read failed:', err.message);
    }

    // Cache miss — fall back to live XRPL request
    const fmt = pairRegistry.toXrplFormat(pairKey);
    if (!fmt) {
      return res.status(404).json({ error: 'Pair not seen in stream yet — no data available' });
    }

    if (!xrplClient.isConnected()) {
      return res.status(503).json({ error: 'XRPL not connected' });
    }

    try {
      const offers = await xrplClient.requestOrderBook(fmt.takerGets, fmt.takerPays);
      return res.json({ source: 'live', pairKey, offers });
    } catch (err) {
      console.error('[BOOK] Live XRPL request failed:', err.message);
      return res.status(502).json({ error: 'Failed to fetch order book from XRPL' });
    }
  });

  return router;
}

module.exports = { createBookRouter };
