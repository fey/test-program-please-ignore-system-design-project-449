-- Таблицы принадлежат обработке уведомлений и учебному провайдеру.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS notify_inbox (
    eventid TEXT PRIMARY KEY, tripid BIGINT NOT NULL, eventtype TEXT NOT NULL,
    version BIGINT NOT NULL, city TEXT NOT NULL, price NUMERIC NOT NULL,
    occurredat TEXT NOT NULL, createdat TEXT NOT NULL, kafka_timestamp TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS notification_jobs (
    event_id TEXT PRIMARY KEY, trip_id BIGINT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
    next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(), claimed_until TIMESTAMPTZ,
    claim_token UUID, last_error TEXT, delivered_at TIMESTAMPTZ, template_version TEXT
);
CREATE TABLE IF NOT EXISTS provider_keys (
    key TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_deliveries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key TEXT NOT NULL, trip_id BIGINT NOT NULL, text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS provider_attempts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
