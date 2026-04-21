const Redis = require('ioredis');

function createRedisClient() {
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    lazyConnect: true,
  });

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  return client;
}

module.exports = { createRedisClient };
