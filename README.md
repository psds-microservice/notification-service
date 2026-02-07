# notification-service

Сервис уведомлений в реальном времени (Node.js, TypeScript). WebSocket по `user_id`, рассылка по `session_id`, потребитель Kafka.

## Стек

- **Node.js 20+**, TypeScript
- **Fastify** — HTTP
- **ws** + **@fastify/websocket** — WebSocket на том же порту, что и HTTP
- **kafkajs** — consumer топиков Kafka (события сессий)

## API

- **GET /health** — health check
- **GET /ready** — readiness
- **GET /ws/notify/:user_id** — WebSocket; клиент может отправить `{"subscribe_session": "uuid"}` / `{"unsubscribe_session": "uuid"}`
- **POST /notify/session/:id** — отправить событие всем подписчикам сессии (body: `{"event": "...", "payload": {}}`)

## Конфигурация

Только `.env` (см. `.env.example`): `APP_PORT=8092`, `KAFKA_BROKERS`, `KAFKA_GROUP_ID`, `KAFKA_TOPICS`.

## Запуск

```bash
npm install
npm run dev
```

Порт по умолчанию **8092**. Сборка: `npm run build && npm start`. Docker: `cd deployments && docker compose up -d` (контекст — корень сервиса).
