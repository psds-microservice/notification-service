# notification-service

Сервис уведомлений в реальном времени (Go). WebSocket `/ws/notify/:user_id`, POST `/notify/session/:id`, consumer Kafka.

## Стек

- Go 1.21+, **Gin**, **gorilla/websocket**, **segmentio/kafka-go**
- Конфиг только `.env`

## API

- `GET /health`, `GET /ready`
- `GET /ws/notify/:user_id` — WebSocket; клиент может отправить `{"subscribe_session": "uuid"}` / `{"unsubscribe_session": "uuid"}`
- `POST /notify/session/:id` — body `{"event": "...", "payload": {}}` — рассылка всем подписчикам сессии

## Запуск

```bash
cp .env.example .env
go run ./cmd/notification-service api
```

Порт по умолчанию **8092**. Kafka и Redis — из `infra-external/` (KAFKA_BROKERS=localhost:9092). Docker: `cd deployments && docker compose up -d`.
