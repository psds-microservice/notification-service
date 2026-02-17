package application

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/psds-microservice/notification-service/internal/config"
	"github.com/psds-microservice/notification-service/internal/handler"
	"github.com/psds-microservice/notification-service/internal/kafka"
	"github.com/psds-microservice/notification-service/internal/service"
)

type API struct {
	cfg *config.Config
	srv *http.Server
	hub *service.NotifyHub
}

func NewAPI(cfg *config.Config) (*API, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	hub := service.NewNotifyHub(cfg.WSSendQueueSize)
	notifyHandler := handler.NewNotifyHandler(hub)

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	handler.RegisterRoutes(r, notifyHandler)

	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	return &API{cfg: cfg, srv: srv, hub: hub}, nil
}

func (a *API) Run(ctx context.Context) error {
	host := a.cfg.AppHost
	if host == "0.0.0.0" {
		host = "localhost"
	}
	base := "http://" + host + ":" + a.cfg.HTTPPort
	log.Printf("HTTP server listening on %s", a.srv.Addr)
	log.Printf("  Swagger UI:    %s/swagger", base)
	log.Printf("  Swagger spec:  %s/swagger/openapi.json", base)
	log.Printf("  Health:        %s/health", base)
	log.Printf("  Ready:         %s/ready", base)
	log.Printf("  WebSocket:     ws://%s:%s/ws/notify/:user_id", host, a.cfg.HTTPPort)

	go kafka.RunConsumer(ctx, a.cfg.KafkaBrokers, a.cfg.KafkaGroupID, a.cfg.KafkaTopics, a.hub)

	go func() {
		if err := a.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("http shutdown: %w", err)
	}
	return nil
}
