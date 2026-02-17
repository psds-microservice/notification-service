package kafka

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/psds-microservice/notification-service/internal/service"
	"github.com/segmentio/kafka-go"
)

func RunConsumer(ctx context.Context, brokers []string, groupID string, topics []string, hub *service.NotifyHub) {
	if len(brokers) == 0 || len(topics) == 0 {
		return
	}

	type routingMessage struct {
		// Общий конверт события, если продюсер его использует.
		Event   string          `json:"event"`
		Payload json.RawMessage `json:"payload,omitempty"`

		// Базовые поля совместимы с предыдущей версией.
		SessionID string   `json:"session_id,omitempty"`
		UserID    string   `json:"user_id,omitempty"`
		UserIDs   []string `json:"user_ids,omitempty"`

		// Для agent routing по операторам/агентам.
		OperatorID  string   `json:"operator_id,omitempty"`
		OperatorIDs []string `json:"operator_ids,omitempty"`

		// Для маршрутизации по регионам и ролям (если клиенты подключаются с этими атрибутами).
		Regions []string `json:"regions,omitempty"`
		Roles   []string `json:"roles,omitempty"`
	}

	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		GroupID:        groupID,
		GroupTopics:    topics,
		MinBytes:       1,
		MaxBytes:       10e6,
		MaxWait:        time.Second,
		StartOffset:    kafka.FirstOffset,
		CommitInterval: time.Second,
	})
	defer r.Close()

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		msg, err := r.ReadMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("kafka read: %v", err)
			continue
		}

		var rm routingMessage
		if err := json.Unmarshal(msg.Value, &rm); err != nil {
			log.Printf("kafka: cannot unmarshal message: %v", err)
			continue
		}

		// Для WebSocket-клиента пересылаем оригинальное тело сообщения как есть.
		out := msg.Value

		// 1. Рассылка по session_id (как раньше).
		if rm.SessionID != "" {
			if sid, err := uuid.Parse(strings.TrimSpace(rm.SessionID)); err == nil {
				hub.BroadcastToSession(sid, out)
			}
		}

		// 2. Прямые получатели по user_id / user_ids / operator_id / operator_ids.
		var directTargets []uuid.UUID
		appendID := func(idStr string) {
			if idStr == "" {
				return
			}
			if uid, err := uuid.Parse(strings.TrimSpace(idStr)); err == nil {
				directTargets = append(directTargets, uid)
			}
		}

		appendID(rm.UserID)
		for _, id := range rm.UserIDs {
			appendID(id)
		}
		appendID(rm.OperatorID)
		for _, id := range rm.OperatorIDs {
			appendID(id)
		}

		if len(directTargets) > 0 {
			hub.BroadcastToUsers(directTargets, out)
		}

		// 3. Маршрутизация по регионам и ролям (если клиенты передают эти атрибуты при подключении).
		if len(rm.Regions) > 0 {
			hub.BroadcastToRegions(rm.Regions, out)
		}
		if len(rm.Roles) > 0 {
			hub.BroadcastToRoles(rm.Roles, out)
		}
	}
}
