// ============================================================
// FINLYTICS — Outbound email (password recovery only)
// ============================================================
'use strict';

const nodemailer = require('nodemailer');

/**
 * Returns { enabled, sendPasswordReset(to, name, link) }.
 * When SMTP is not configured, enabled=false and password recovery is turned off.
 */
function createMailer(config) {
  if (!config.email.enabled) {
    return { enabled: false, async sendPasswordReset() { throw new Error('Email is not configured'); } };
  }
  const transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    requireTLS: !config.email.secure,
    auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    enabled: true,
    async sendPasswordReset(to, name, link, ttlMinutes) {
      await transport.sendMail({
        from: config.email.from,
        to,
        subject: 'Reset your Finlytics password',
        text:
`Hi ${name},

Someone (hopefully you) asked to reset the password for your Finlytics account.
Open this link within ${ttlMinutes} minutes to choose a new password:

${link}

The link works once. If you did not request this, you can ignore this email; your password will not change.`,
      });
    },
  };
}

module.exports = { createMailer };
