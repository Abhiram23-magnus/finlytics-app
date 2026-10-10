#!/usr/bin/env node
// Applies pending database migrations: `npm run migrate`
'use strict';

require('dotenv').config({ quiet: true });
const { loadConfig } = require('../lib/config');
const { createPool } = require('../db/pool');
const { migrate }    = require('../db/migrate');

(async () => {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    const applied = await migrate(pool, { log: console.log });
    console.log(applied.length ? `  Done (${applied.length} applied).` : '  Database is up to date.');
  } finally {
    await pool.end();
  }
})().catch(err => {
  console.error('  ❌ ', err.message);
  process.exit(1);
});
