const { Router } = require('express');
const { getBridgeEvents, WINDOWS } = require('../redis/bridgeTimeseries');

function createBridgeRouter({ redis }) {
  const router = Router();

  router.get('/events', async (req, res) => {
    const { window = '1h' } = req.query;
    if (!WINDOWS[window]) {
      return res.status(400).json({ error: `Unknown window. Valid: ${Object.keys(WINDOWS).join(', ')}` });
    }
    try {
      const events = await getBridgeEvents(redis, window);
      res.json({ window, events });
    } catch (err) {
      console.error('[BRIDGE/EVENTS] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createBridgeRouter };
