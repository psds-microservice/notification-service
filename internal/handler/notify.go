package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/psds-microservice/notification-service/api"
	"github.com/psds-microservice/notification-service/internal/service"
	"github.com/psds-microservice/notification-service/pkg/constants"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type NotifyHandler struct {
	Hub *service.NotifyHub
}

func NewNotifyHandler(hub *service.NotifyHub) *NotifyHandler {
	return &NotifyHandler{Hub: hub}
}

func (h *NotifyHandler) ServeWS(c *gin.Context) {
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

type NotifySessionRequest struct {
	Event   string          `json:"event"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func (h *NotifyHandler) NotifySession(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session id"})
		return
	}
	var req NotifySessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if req.Event == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "event required"})
		return
	}
	msg, _ := json.Marshal(gin.H{"event": req.Event, "payload": req.Payload})
	h.Hub.BroadcastToSession(sessionID, msg)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func RegisterRoutes(r *gin.Engine, notify *NotifyHandler) {
	r.GET(constants.PathHealth, Health)
	r.GET(constants.PathReady, Ready)
	r.GET(constants.PathSwagger, func(c *gin.Context) { c.Redirect(http.StatusFound, constants.PathSwagger+"/") })
	r.GET(constants.PathSwagger+"/*any", func(c *gin.Context) {
		if strings.TrimPrefix(c.Param("any"), "/") == "openapi.json" {
			c.Data(http.StatusOK, "application/json", api.OpenAPISpec)
			return
		}
		if strings.TrimPrefix(c.Param("any"), "/") == "" {
			c.Request.URL.Path = constants.PathSwagger + "/index.html"
			c.Request.RequestURI = constants.PathSwagger + "/index.html"
		}
		ginSwagger.WrapHandler(swaggerFiles.Handler, ginSwagger.URL("/swagger/openapi.json"))(c)
	})
	r.GET("/ws/notify/:user_id", notify.ServeWS)
	r.POST("/notify/session/:id", notify.NotifySession)
}
