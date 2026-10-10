-- Allow every ISO 4217 currency. The exact list is enforced by the application
-- (public/currencies.js); the database keeps the format check.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_currency_check;
ALTER TABLE users ADD CONSTRAINT users_currency_check CHECK (currency ~ '^[A-Z]{3}$');
