// ============================================================
// FINLYTICS — Server entry point
// ============================================================
// Locally: `npm start` listens on PORT. On Vercel, this module's export (the
// Express app) is used as the serverless handler and listen() is not called.
'use strict';

require('dotenv').config({ quiet: true });
const { loadConfig } = require('./lib/config');
const { createApp }  = require('./lib/createApp');

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const app = createApp({ config });

if (require.main === module) {
  const { pendingMigrations } = require('./db/migrate');
  const pool = app.locals.pool;

  pendingMigrations(pool).then(pending => {
    if (pending.length) {
      console.error(`  ❌  Database has ${pending.length} pending migration(s). Run \`npm run migrate\` first.`);
      process.exit(1);
    }
    const server = app.listen(config.port, () => {
      console.log(`\n  🚀  Finlytics running at http://localhost:${config.port} (${config.nodeEnv})\n`);
    });
    const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }).catch(err => {
    console.error('  ❌  Could not connect to the database:', err.code || err.message);
    process.exit(1);
  });
}

// Serverless: optionally apply pending migrations once per instance before the first
// request. migrate() holds a PostgreSQL advisory lock, so concurrent cold starts are safe.
let handler = app;
if (require.main !== module && config.autoMigrate) {
  const { migrate } = require('./db/migrate');
  let ready = null;
  handler = (req, res) => {
    ready = ready || migrate(app.locals.pool, { log: msg => console.log(msg) }).catch(err => {
      ready = null; // retry on the next request
      throw err;
    });
    ready.then(() => app(req, res), err => {
      console.error('  ❌  Migration failed:', err.code || err.message);
      res.statusCode = 503;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Service unavailable: database setup failed.');
    });
  };
}

module.exports = handler;
