package grpc

import (
	"context"
	"encoding/json"
	"log"

	"github.com/google/uuid"
	"github.com/psds-microservice/notification-service/internal/service"
	"github.com/psds-microservice/notification-service/pkg/gen/notification_service"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Deps — зависимости gRPC-сервера
type Deps struct {
	Hub *service.NotifyHub
}

// Server implements notification_service.NotificationServiceServer
type Server struct {
	notification_service.UnimplementedNotificationServiceServer
	Deps
}

// NewServer создаёт gRPC-сервер с внедрёнными сервисами
func NewServer(deps Deps) *Server {
	return &Server{Deps: deps}
}

func (s *Server) mapError(err error) error {
	if err == nil {
		return nil
	}
	log.Printf("grpc: error: %v", err)
	return status.Error(codes.Internal, err.Error())
}

func (s *Server) NotifySession(ctx context.Context, req *notification_service.NotifySessionRequest) (*notification_service.NotifySessionResponse, error) {
	sessionID, err := uuid.Parse(req.GetId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid session id")
	}
	if req.GetEvent() == "" {
		return nil, status.Error(codes.InvalidArgument, "event is required")
	}

	// Формируем сообщение для broadcast (payload — arbitrary JSON object via Struct)
	var payload interface{}
	if req.GetPayload() != nil {
		payload = req.GetPayload().AsMap()
	}
	msg, err := json.Marshal(map[string]interface{}{
		"event":   req.GetEvent(),
		"payload": payload,
	})
	if err != nil {
		return nil, s.mapError(err)
	}

	s.Hub.BroadcastToSession(sessionID, msg)
	return &notification_service.NotifySessionResponse{Ok: true}, nil
}
