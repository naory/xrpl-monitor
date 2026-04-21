const BOOK_TTL_SECONDS = 10; // roughly 2-3 ledger closes

function bookKey(pairKey) {
  return `book:${pairKey}`;
}

async function setOrderBook(redis, pairKey, { bids, asks, ledgerIndex }) {
  const value = JSON.stringify({ bids, asks, ledgerIndex, cachedAt: Date.now() });
  await redis.set(bookKey(pairKey), value, 'EX', BOOK_TTL_SECONDS);
}

async function getOrderBook(redis, pairKey) {
  const raw = await redis.get(bookKey(pairKey));
  if (!raw) return null;
  return JSON.parse(raw);
}

async function deleteOrderBook(redis, pairKey) {
  await redis.del(bookKey(pairKey));
}

module.exports = { setOrderBook, getOrderBook, deleteOrderBook };
