setup:
	npm ci
	npm run migrate

migrate:
	npm run migrate

start:
	node src/index.ts

lint:
	npx tsc --noEmit

test:
	npx tsc --noEmit

# Стенд целиком. Порядок важен: приложению нужны зависимости и схема, а схему
# применяет цель setup в контейнере приложения при поднятой базе.
up:
	docker compose up -d --wait db
	docker compose run --rm app make setup
	docker compose up -d --wait app provider
	@if [ "$$(docker compose exec -T app node -p "JSON.parse(require('node:fs').readFileSync('config/source.json', 'utf8')).mode")" != "direct" ]; then $(MAKE) stream-up; fi

down:
	docker compose down -v --remove-orphans

# Применить config/*.json к Kafka Connect после правки файла.
apply:
	docker compose exec -T app node bin/apply.ts

# Применить db/report.sql, то есть создать или обновить представление отчёта.
report:
	docker compose exec -T db psql -U postgres -d taxi -v ON_ERROR_STOP=1 -q < db/report.sql

psql:
	docker compose exec db psql -U postgres -d taxi

# Опыты. N поездок создаются, назначаются и завершаются через HTTP.
# HOT задаёт долю главного города, DAYS_BACK разбрасывает время завершения
# случайно в пределах последних DAYS_BACK суток.
traffic:
	docker compose exec -T -e N=$(or $(N),100) -e HOT=$(or $(HOT),0.7) -e DAYS_BACK=$(or $(DAYS_BACK),0) -e RPS=$(or $(RPS),0) app node bin/traffic.ts

# Создать и назначить одну поездку, номер печатается: make trip [CITY=kazan]
trip:
	@docker compose exec -T -e CITY=$(or $(CITY),moscow) app node bin/trip.ts

# Завершить одну поездку: make complete TRIP=1 [AT=2026-01-05T10:00:00Z]
complete:
	docker compose exec -T app curl -sS -X POST localhost:8080/trips/$(TRIP)/complete -H 'content-type: application/json' -d '{$(if $(AT),"completedAt":"$(AT)")}'; echo

# Отказ базы для поездки: make fail-next TRIP=1 [WHERE=outbox|trip]
fail-next:
	docker compose exec -T db psql -U postgres -d taxi -q -c "INSERT INTO chaos_poison (trip_id, at) VALUES ($(TRIP), '$(or $(WHERE),outbox)') ON CONFLICT DO NOTHING"

fail-clear:
	docker compose exec -T db psql -U postgres -d taxi -q -c "DELETE FROM chaos_poison"

# Управление приёмником: make pause SINK=projection-sink
status pause resume replay:
	docker compose exec -T app node bin/sink.ts $@ $(SINK)

# Позиция каждой группы приёмников и накопившееся отставание.
lag:
	docker compose exec -T kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --all-groups 2>/dev/null | grep -E 'GROUP|events' || true

# Число сообщений в каждой партиции топика.
partitions:
	docker compose exec -T kafka /opt/kafka/bin/kafka-get-offsets.sh --bootstrap-server localhost:9092 --topic events.trip

# Сверка отчёта с основной базой по парам «город, день».
reconcile:
	docker compose exec -T app node bin/reconcile.ts

.PHONY: setup migrate start lint test up down apply report psql traffic trip complete fail-next fail-clear status pause resume replay lag partitions reconcile

# Подключение событийной части после выбора модели взаимодействия.
stream-up:
	docker compose up -d --wait kafka connect
	docker compose exec -T app node bin/apply.ts
	docker compose up -d --wait notifier

provider:
	docker compose exec -T -e LIMIT=$(or $(LIMIT),100) app node bin/provider.ts $(or $(MODE),healthy)

notifications:
	docker compose exec -T db psql -U postgres -d taxi -c 'SELECT state, count(*), max(attempts) AS attempts FROM notification_jobs GROUP BY state'

notifier-release:
	cp config/notifier-$(or $(VERSION),v1).json config/notifier.json
	docker compose up -d --wait --no-deps --force-recreate notifier

notifier-stop:
	docker compose stop notifier

notifier-start:
	docker compose up -d --wait notifier

.PHONY: stream-up provider notifications notifier-release notifier-stop notifier-start

activate:
	docker compose stop app
	docker compose run --rm --no-deps app make migrate
	docker compose run --rm --no-deps app node bin/backfill.ts
	docker compose up -d --wait --force-recreate app
	$(MAKE) stream-up

backfill:
	docker compose exec -T app node bin/backfill.ts

source-report:
	docker compose exec -T db psql -U postgres -d taxi -c "SELECT city, status, count(*) FROM trips GROUP BY city, status ORDER BY city, status"

rebuild-report:
	docker compose exec -T app node bin/rebuild.ts

.PHONY: activate backfill source-report rebuild-report

# Перезапуск не повторяет начальный снимок.
app-restart:
	docker compose up -d --wait --no-deps --force-recreate app

notifier-status:
	docker compose exec -T notifier curl -fsS localhost:8082/health

freshness:
	docker compose exec -T app node bin/freshness.ts

.PHONY: app-restart notifier-status freshness
