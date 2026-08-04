const { upsertDomain, upsertDexOffer } = require('../db/domains');

const DEX_PAGES_PER_CYCLE = 200;

function dexMarkerKey(network) {
  return `domains:dex_marker:${network}`;
}

async function crawlDomains(xrplClient, pool, network) {
  let marker, count = 0;
  do {
    const res = await xrplClient.request({
      command: 'ledger_data',
      type: 'permissioned_domain',
      limit: 400,
      ...(marker ? { marker } : {}),
    });
    for (const obj of res.result.state ?? []) {
      await upsertDomain(pool, network, obj);
      count++;
    }
    marker = res.result.marker;
  } while (marker);
  if (count > 0) console.log(`[Domains] Crawled ${count} permissioned domain(s) on ${network}`);
  return count;
}

async function crawlDexOffers(xrplClient, pool, redis, network) {
  const key = dexMarkerKey(network);
  let marker = (await redis.get(key)) || undefined;
  let count = 0, pages = 0;
  do {
    const res = await xrplClient.request({
      command: 'ledger_data',
      type: 'offer',
      limit: 400,
      ...(marker ? { marker } : {}),
    });
    for (const obj of res.result.state ?? []) {
      if (obj.DomainID) {
        await upsertDexOffer(pool, network, obj);
        count++;
      }
    }
    marker = res.result.marker;
    pages++;
    if (marker) await redis.set(key, marker);
    else         await redis.del(key); // full scan done — restart next cycle
  } while (marker && pages < DEX_PAGES_PER_CYCLE);
  if (count > 0) console.log(`[Domains] Found ${count} permissioned DEX offer(s) in ${pages} pages on ${network}`);
}

function startDomainCrawler(xrplClient, pool, redis, getNetwork) {
  let running = false;

  async function cycle() {
    if (running || !xrplClient.isConnected()) return;
    running = true;
    try {
      const network = getNetwork();
      await crawlDomains(xrplClient, pool, network);
      await crawlDexOffers(xrplClient, pool, redis, network);
    } catch (err) {
      console.error('[Domains] Crawl error:', err.message);
    } finally {
      running = false;
    }
  }

  // First crawl 10s after boot (give XRPL time to connect and subscribe)
  const initTimer = setTimeout(cycle, 10_000);
  const cycleTimer = setInterval(cycle, 15 * 60_000);

  return {
    refresh: cycle,
    stop: () => { clearTimeout(initTimer); clearInterval(cycleTimer); },
  };
}

module.exports = { startDomainCrawler };
