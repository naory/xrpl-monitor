const path = require('path');
const fs   = require('fs');

async function runMigrations(pool) {
  const sql = fs.readFileSync(path.join(__dirname, '../../schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[DB] Schema migrations applied');
}

module.exports = { runMigrations };
