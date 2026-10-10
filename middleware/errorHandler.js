// ============================================================
// FINLYTICS — Centralized error handling
// ============================================================
// Responses never include stack traces, SQL, or internal messages. Logs carry
// the error code/message and request id, but never request bodies (which may
// contain passwords, tokens or financial data).
'use strict';

const { ValidationError } = require('../lib/validation');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return;

  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message, field: err.field });
  }
  // body-parser errors
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    return res.status(415).json({ error: 'Unsupported request encoding.' });
  }
  if (err.status === 403 && err.code === 'CORS_REJECTED') return res.status(403).json({ error: 'Origin not allowed.' });

  // PostgreSQL constraint violations that slipped past validation
  if (err.code === '23505') return res.status(409).json({ error: 'That record already exists.' });
  if (err.code === '23514' || err.code === '22P02' || err.code === '22003' || err.code === '22007' || err.code === '22008') {
    return res.status(400).json({ error: 'Invalid input.' });
  }

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.path} →`, err.code || '', err.message);
    if (process.env.NODE_ENV !== 'production' && err.stack) console.error(err.stack);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
  return res.status(status).json({ error: err.expose ? err.message : 'Request could not be processed.' });
}

module.exports = { notFound, errorHandler };
