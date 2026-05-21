const { Router } = require('express');
const { publishNetworkChange } = require('../redis/publisher');

const VALID_NETWORKS = ['mainnet', 'testnet', 'devnet'];

function validateNetworkName(name) {
  if (!name || !VALID_NETWORKS.includes(name)) {
    return `Invalid network "${name}". Must be one of: ${VALID_NETWORKS.join(', ')}`;
  }
  return null;
}

function createNetworkRouter({ xrplClient, redis, state }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ network: xrplClient.getCurrentNetwork() });
  });

  router.post('/switch', async (req, res) => {
    const { network } = req.body;
    const err = validateNetworkName(network);
    if (err) return res.status(400).json({ error: err });

    try {
      await xrplClient.switchNetwork(network);
      if (state) {
        state.lastKnownLedger = null;
        state.lastLedgerIndex = null;
        state.currentLedger   = null;
      }
      await publishNetworkChange(redis, network).catch((e) => {
        console.error('[network] Failed to publish network_change event:', e);
      });
      res.json({ network });
    } catch (e) {
      if (!e.status) console.error('[network] POST /switch unexpected error:', e);
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { VALID_NETWORKS, validateNetworkName, createNetworkRouter };
