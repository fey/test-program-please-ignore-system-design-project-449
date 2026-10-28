-- Инструмент опытов. Запись в chaos_poison заставляет базу отказать на
-- вставке в outbox (at = 'outbox') или на завершении поездки (at = 'trip').
-- Так отказ между двумя записями воспроизводится по команде, а не случайно.
-- Команда make fail-next добавляет запись, make fail-clear убирает.
CREATE TABLE IF NOT EXISTS chaos_poison (
    trip_id BIGINT NOT NULL,
    at TEXT NOT NULL CHECK (at IN ('outbox', 'trip')),
    PRIMARY KEY (trip_id, at)
);

CREATE OR REPLACE FUNCTION chaos_fail_outbox() RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM chaos_poison
        WHERE at = 'outbox' AND trip_id::TEXT IN (NEW.payload ->> 'tripId', NEW.aggregateid)
    ) THEN
        RAISE EXCEPTION 'chaos: отказ при записи в outbox для поездки %', NEW.payload ->> 'tripId';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION chaos_fail_trip() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status <> 'completed'
       AND EXISTS (SELECT 1 FROM chaos_poison WHERE at = 'trip' AND trip_id = NEW.id) THEN
        RAISE EXCEPTION 'chaos: отказ при завершении поездки %', NEW.id;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chaos_outbox ON outbox;
CREATE TRIGGER chaos_outbox BEFORE INSERT ON outbox
    FOR EACH ROW EXECUTE FUNCTION chaos_fail_outbox();

DROP TRIGGER IF EXISTS chaos_trip ON trips;
CREATE TRIGGER chaos_trip BEFORE UPDATE ON trips
    FOR EACH ROW EXECUTE FUNCTION chaos_fail_trip();
