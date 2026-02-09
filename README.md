# notification-service

Сервис уведомлений в реальном времени (Node.js, TypeScript). WebSocket по `user_id`, рассылка по `session_id`, потребитель Kafka.

## Стек

- **Node.js 20+**, TypeScript
- **Fastify** — HTTP (порт 8092)
- **uWebSockets.js** — WebSocket на отдельном порту 8094
- **kafkajs** — consumer топиков Kafka (сообщения в Protobuf, fallback JSON)
- **PostgreSQL** — опционально: события и pending (fallback push)

## API

- **GET /health** — health check
- **GET /ready** — readiness
- **GET /ws/notify/:user_id** — WebSocket (порт **8094**); клиент может отправить `{"subscribe_session": "uuid"}` / `{"unsubscribe_session": "uuid"}`
- **POST /notify/session/:id** — отправить событие всем подписчикам сессии (body: `{"event": "...", "payload": {}}`); при недоступности WS — fallback в таблицу pending
- **GET /notify/session/:id/listeners** — список user_id, подписанных на сессию (слушатели)
- **GET /notify/pending/:user_id** — непрочитанные уведомления для user_id (fallback push); после выдачи удаляются

## Конфигурация

Только `.env` (см. `.env.example`): `APP_PORT=8092`, `WS_PORT=8094`, `KAFKA_BROKERS`, `KAFKA_GROUP_ID`, `KAFKA_TOPICS`, опционально `DB_*`, `REDIS_URL`.

- **WS_SEND_QUEUE_SIZE** — макс. сообщений в очереди отправки на одно соединение (по умолчанию 256); при переполнении сообщения отбрасываются, в лог пишется предупреждение.
- **WS_MAX_CONNECTIONS_PER_IP** — макс. WebSocket-соединений с одного IP (0 = без лимита). IP берётся из `X-Forwarded-For` или `X-Real-IP`.
- **WS_MAX_CONNECTIONS_TOTAL** — макс. общее число соединений (0 = без лимита). При превышении новый upgrade получает 503.
- **REDIS_URL** — при заданном значении все уведомления публикуются в Redis (канал `psds:notification`); каждый инстанс подписан и доставляет по своим WebSocket. Нужно для мультиинстанса без sticky sessions.

## Fallback push

При недоступности WebSocket (пользователь офлайн) события сохраняются в таблицу `notification_pending`. Клиент при следующем подключении может запросить **GET /notify/pending/:user_id** и получить накопленные уведомления.

## Kafka

Сообщения в топиках ожидаются в **Protobuf** (см. `proto/session_event.proto`). При ошибке декодирования используется JSON (обратная совместимость).

## Запуск

```bash
npm install
npm run dev
```

HTTP — порт **8092**, WebSocket — порт **8094**. Сборка: `npm run build && npm start`. Docker: `cd deployments && docker compose up -d` (контекст — корень сервиса).

Миграции: выполнить `database/migrations/000001_*.up.sql` и `000002_*.up.sql` на своей PostgreSQL.

## Очередь отправки и лимиты

- Очередь на соединение ограничена (`WS_SEND_QUEUE_SIZE`). При переполнении новые сообщения отбрасываются, в лог — `[notify] dropped message (queue full) for user <user_id>`.
- Лимиты соединений (по IP и общий) защищают от перегрузки; при превышении новый WebSocket получает **503 Service Unavailable**.

## Мультиинстанс (Redis)

При заданном `REDIS_URL` Kafka и POST /notify/session публикуют события в Redis. Все инстансы notification-service подписаны на канал `psds:notification` и доставляют сообщения только по своим WebSocket. Можно запускать несколько реплик за балансировщиком без sticky sessions.
