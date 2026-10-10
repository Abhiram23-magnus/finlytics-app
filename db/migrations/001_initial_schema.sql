-- ============================================================
-- FINLYTICS — 001 initial schema
-- ============================================================

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  email          VARCHAR(254) NOT NULL CHECK (email = lower(btrim(email))),
  password_hash  VARCHAR(100) NOT NULL,
  currency       CHAR(3)      NOT NULL DEFAULT 'USD'
                 CHECK (currency IN ('USD','EUR','GBP','INR','JPY','CAD','AUD')),
  theme          VARCHAR(5)   NOT NULL DEFAULT 'dark' CHECK (theme IN ('light','dark')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(7)  NOT NULL CHECK (type IN ('income','expense')),
  name        VARCHAR(40) NOT NULL CHECK (length(btrim(name)) > 0),
  emoji       VARCHAR(16) NOT NULL DEFAULT '🏷',
  color       CHAR(7)     NOT NULL DEFAULT '#10B981' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One category per name (case-insensitive) per type per user
CREATE UNIQUE INDEX categories_user_type_name_key ON categories (user_id, type, lower(name));

CREATE TABLE transactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(7)    NOT NULL CHECK (type IN ('income','expense')),
  merchant    VARCHAR(100)  NOT NULL CHECK (length(btrim(merchant)) > 0),
  category    VARCHAR(40)   NOT NULL CHECK (length(btrim(category)) > 0),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  date        DATE          NOT NULL CHECK (date BETWEEN DATE '1970-01-01' AND DATE '2100-12-31'),
  notes       VARCHAR(500)  NOT NULL DEFAULT '',
  recurring   BOOLEAN       NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX transactions_user_date_idx ON transactions (user_id, date DESC, id DESC);
CREATE INDEX transactions_user_type_category_idx ON transactions (user_id, type, category);

CREATE TABLE budgets (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      VARCHAR(40)   NOT NULL CHECK (length(btrim(category)) > 0),
  limit_amount  NUMERIC(14,2) NOT NULL CHECK (limit_amount > 0 AND limit_amount <= 1000000000),
  emoji         VARCHAR(16)   NOT NULL DEFAULT '💳',
  color         CHAR(7)       NOT NULL DEFAULT '#6366F1' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX budgets_user_category_key ON budgets (user_id, lower(category));

CREATE TABLE monthly_budgets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       CHAR(7)       NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE TABLE password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64)    NOT NULL UNIQUE,   -- SHA-256 hex; the raw token is never stored
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

-- Session store used by connect-pg-simple
CREATE TABLE session (
  sid     VARCHAR      NOT NULL PRIMARY KEY,
  sess    JSON         NOT NULL,
  expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session (expire);

-- Shared rate-limit counters (work across serverless instances)
CREATE TABLE rate_limits (
  key       VARCHAR(300) PRIMARY KEY,
  hits      INTEGER      NOT NULL,
  reset_at  TIMESTAMPTZ  NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);
