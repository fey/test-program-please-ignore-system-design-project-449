-- Очередь событий для других систем. Приложение событий не публикует: строки
-- этой таблицы читает Debezium из журнала базы. Колонки названы так, как их
-- ждёт Debezium Outbox Event Router.
--
-- aggregatetype задаёт имя топика, aggregateid становится ключом сообщения,
-- payload становится телом. Колонка occurred_at хранит время факта в UTC,
-- и роутер умеет ставить его временем сообщения. Тип timestamp выбран не
-- случайно: роутер принимает только колонку с логическим типом времени, а
-- timestamptz и bigint он отвергает.
CREATE TABLE IF NOT EXISTS outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregatetype TEXT NOT NULL,
    aggregateid TEXT NOT NULL,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMP
);
