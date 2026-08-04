const express = require('express');
const { searchDomains, getDomainById, getDexOffers } = require('../db/domains');

function createDomainsRouter({ pool, xrplClient, crawler }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const network = xrplClient.getCurrentNetwork();
    const { search = '', limit = 50, offset = 0 } = req.query;
    try {
      const result = await searchDomains(pool, network, {
        search: search.trim(),
        limit:  Math.min(parseInt(limit)  || 50, 200),
        offset: parseInt(offset) || 0,
      });
      res.json(result);
    } catch (err) {
      console.error('[DOMAINS] Search error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/dex', async (req, res) => {
    const network = xrplClient.getCurrentNetwork();
    const { search = '', limit = 100, offset = 0 } = req.query;
    try {
      const result = await getDexOffers(pool, network, {
        search: search.trim(),
        limit:  Math.min(parseInt(limit)  || 100, 500),
        offset: parseInt(offset) || 0,
      });
      res.json(result);
    } catch (err) {
      console.error('[DOMAINS] DEX search error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:id', async (req, res) => {
    const network = xrplClient.getCurrentNetwork();
    try {
      const domain = await getDomainById(pool, network, req.params.id);
      if (!domain) return res.status(404).json({ error: 'Domain not found' });
      res.json(domain);
    } catch (err) {
      console.error('[DOMAINS] Get error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/crawl', (req, res) => {
    res.json({ ok: true });
    crawler.refresh().catch(() => {});
  });

  return router;
}

module.exports = { createDomainsRouter };
