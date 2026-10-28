CREATE TABLE IF NOT EXISTS source_activation (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS initial_trip_facts (
    event_id UUID PRIMARY KEY, payload JSONB NOT NULL
);
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS enqueued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
ALTER TABLE notify_inbox ADD COLUMN IF NOT EXISTS job_created BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS notify_unprocessed ON notify_inbox(eventid)
    WHERE eventtype='created' AND NOT historical AND NOT job_created;
ALTER TABLE notification_jobs ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMPTZ;
ALTER TABLE provider_deliveries ADD COLUMN IF NOT EXISTS template_version TEXT;
CREATE TABLE IF NOT EXISTS notification_rate_gate (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    next_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO notification_rate_gate (singleton) VALUES (TRUE) ON CONFLICT DO NOTHING;
-- Тип стоимости задан явно и не зависит от первого сообщения JSON.
CREATE TABLE IF NOT EXISTS trip_facts (
    eventid TEXT NOT NULL, tripid BIGINT NOT NULL, eventtype TEXT NOT NULL,
    version BIGINT NOT NULL, city TEXT NOT NULL, price NUMERIC NOT NULL,
    occurredat TEXT NOT NULL, createdat TEXT NOT NULL, historical BOOLEAN NOT NULL,
    kafka_timestamp TIMESTAMPTZ, kafka_partition INT, kafka_offset BIGINT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS trip_facts_v2 (LIKE trip_facts INCLUDING DEFAULTS);
ALTER TABLE trip_facts ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
ALTER TABLE trip_facts_v2 ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

-- Сохраним правило известного представления при обновлении прежней схемы.
DO $migration$
DECLARE target RECORD; definition TEXT; old_type TEXT;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('trip_facts','daily_report'), ('trip_facts_v2','daily_report_v2')
  ) AS t(table_name,view_name) LOOP
    SELECT udt_name INTO old_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=target.table_name AND column_name='price';
    IF old_type <> 'numeric' THEN
      SELECT pg_get_viewdef(c.oid,TRUE) INTO definition FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=target.view_name AND c.relkind='v';
      IF definition IS NOT NULL THEN EXECUTE format('DROP VIEW %I',target.view_name); END IF;
      EXECUTE format('ALTER TABLE %I ALTER COLUMN price TYPE NUMERIC USING price::numeric',target.table_name);
      IF definition IS NOT NULL THEN EXECUTE format('CREATE VIEW %I AS %s',target.view_name,definition); END IF;
    END IF;
  END LOOP;
END $migration$;
