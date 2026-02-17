package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/psds-microservice/notification-service/internal/service"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type WebSocketHandler struct {
	Hub *service.NotifyHub
}

func NewWebSocketHandler(hub *service.NotifyHub) *WebSocketHandler {
	return &WebSocketHandler{Hub: hub}
}

func (h *WebSocketHandler) ServeWS(c *gin.Context) {
	userIDStr := c.Param("user_id")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	// Дополнительные атрибуты клиента (для agent routing) можно передавать в query:
	//   /ws/notify/{user_id}?region=ru-msk&roles=operator,premium
	region := strings.TrimSpace(c.Query("region"))
	var roles []string
	if rawRoles := c.Query("roles"); rawRoles != "" {
		for _, r := range strings.Split(rawRoles, ",") {
			if v := strings.TrimSpace(r); v != "" {
				roles = append(roles, v)
			}
		}
	}

	meta := service.ClientMetadata{
		Region: region,
		Roles:  roles,
	}

	client := h.Hub.Register(userID, conn, meta)
	defer h.Hub.Unregister(userID)

	go client.WritePump()
	client.ReadPump(h.Hub, userID)
}
