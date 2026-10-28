-- Пассажиры и водители стенда. Поездок в данных нет: их создаёт генератор,
INSERT INTO passengers (name, phone)
SELECT 'Passenger ' || n, '+79' || LPAD(n::TEXT, 9, '0')
FROM generate_series(1, 1000) AS s(n)
ON CONFLICT (phone) DO NOTHING;

INSERT INTO drivers (name)
SELECT 'Driver ' || n
FROM generate_series(1, 1000) AS s(n)
WHERE NOT EXISTS (SELECT 1 FROM drivers);
