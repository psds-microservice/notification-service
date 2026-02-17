package service

import (
	"encoding/json"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// SessionBroadcaster — интерфейс для gRPC Deps (Dependency Inversion).
type SessionBroadcaster interface {
	BroadcastToSession(sessionID uuid.UUID, msg []byte)
}

type NotifyHub struct {
	mu            sync.RWMutex
	users         map[uuid.UUID]*ClientConn
	sessions      map[uuid.UUID]map[uuid.UUID]struct{}
	regions       map[string]map[uuid.UUID]struct{}
	roles         map[string]map[uuid.UUID]struct{}
	sendQueueSize int
}

type ClientConn struct {
	UserID uuid.UUID
	Conn   *websocket.Conn
	Send   chan []byte
	Meta   ClientMetadata
}

// ClientMetadata описывает базовые атрибуты подключённого клиента
// для agent routing: регион, роли и т.п.
type ClientMetadata struct {
	Region string
	Roles  []string
}

func NewNotifyHub(sendQueueSize int) *NotifyHub {
	if sendQueueSize <= 0 {
		sendQueueSize = 256
	}
	return &NotifyHub{
		users:         make(map[uuid.UUID]*ClientConn),
		sessions:      make(map[uuid.UUID]map[uuid.UUID]struct{}),
		regions:       make(map[string]map[uuid.UUID]struct{}),
		roles:         make(map[string]map[uuid.UUID]struct{}),
		sendQueueSize: sendQueueSize,
	}
}

func (h *NotifyHub) Register(userID uuid.UUID, conn *websocket.Conn, meta ClientMetadata) *ClientConn {
	h.mu.Lock()
	if old, ok := h.users[userID]; ok {
		close(old.Send)
		delete(h.users, userID)
	}
	c := &ClientConn{UserID: userID, Conn: conn, Send: make(chan []byte, h.sendQueueSize), Meta: meta}
	h.users[userID] = c
	// Индексация по региону и ролям для agent routing.
	if meta.Region != "" {
		if h.regions[meta.Region] == nil {
			h.regions[meta.Region] = make(map[uuid.UUID]struct{})
		}
		h.regions[meta.Region][userID] = struct{}{}
	}
	for _, role := range meta.Roles {
		if role == "" {
			continue
		}
		if h.roles[role] == nil {
			h.roles[role] = make(map[uuid.UUID]struct{})
		}
		h.roles[role][userID] = struct{}{}
	}
	h.mu.Unlock()
	return c
}

func (h *NotifyHub) Unregister(userID uuid.UUID) {
	h.mu.Lock()
	if c, ok := h.users[userID]; ok {
		close(c.Send)
		delete(h.users, userID)
		// Удаляем пользователя из индексов регионов и ролей.
		if c.Meta.Region != "" {
			if m := h.regions[c.Meta.Region]; m != nil {
				delete(m, userID)
				if len(m) == 0 {
					delete(h.regions, c.Meta.Region)
				}
			}
		}
		for _, role := range c.Meta.Roles {
			if m := h.roles[role]; m != nil {
				delete(m, userID)
				if len(m) == 0 {
					delete(h.roles, role)
				}
			}
		}
	}
	for _, m := range h.sessions {
		delete(m, userID)
	}
	h.mu.Unlock()
}

func (h *NotifyHub) SubscribeSession(sessionID, userID uuid.UUID) {
	h.mu.Lock()
	if h.sessions[sessionID] == nil {
		h.sessions[sessionID] = make(map[uuid.UUID]struct{})
	}
	h.sessions[sessionID][userID] = struct{}{}
	h.mu.Unlock()
}

func (h *NotifyHub) UnsubscribeSession(sessionID, userID uuid.UUID) {
	h.mu.Lock()
	if m := h.sessions[sessionID]; m != nil {
		delete(m, userID)
	}
	h.mu.Unlock()
}

func (h *NotifyHub) BroadcastToSession(sessionID uuid.UUID, msg []byte) {
	h.mu.RLock()
	m, ok := h.sessions[sessionID]
	if !ok {
		h.mu.RUnlock()
		return
	}
	userIDs := make([]uuid.UUID, 0, len(m))
	for uid := range m {
		userIDs = append(userIDs, uid)
	}
	h.mu.RUnlock()
	h.BroadcastToUsers(userIDs, msg)
}

func (h *NotifyHub) SendToUser(userID uuid.UUID, msg []byte) {
	h.mu.RLock()
	c := h.users[userID]
	h.mu.RUnlock()
	if c != nil {
		select {
		case c.Send <- msg:
		default:
			// queue full, drop
		}
	}
}

// BroadcastToUsers отправляет сообщение конкретному набору пользователей.
func (h *NotifyHub) BroadcastToUsers(userIDs []uuid.UUID, msg []byte) {
	for _, uid := range userIDs {
		h.SendToUser(uid, msg)
	}
}

// BroadcastToRegion отправляет сообщение всем пользователям, подключённым из указанного региона.
func (h *NotifyHub) BroadcastToRegion(region string, msg []byte) {
	if region == "" {
		return
	}
	h.mu.RLock()
	m, ok := h.regions[region]
	if !ok {
		h.mu.RUnlock()
		return
	}
	userIDs := make([]uuid.UUID, 0, len(m))
	for uid := range m {
		userIDs = append(userIDs, uid)
	}
	h.mu.RUnlock()
	h.BroadcastToUsers(userIDs, msg)
}

// BroadcastToRegions отправляет сообщение по нескольким регионам.
func (h *NotifyHub) BroadcastToRegions(regions []string, msg []byte) {
	seen := make(map[uuid.UUID]struct{})
	var targets []uuid.UUID
	h.mu.RLock()
	for _, region := range regions {
		if region == "" {
			continue
		}
		m := h.regions[region]
		for uid := range m {
			if _, ok := seen[uid]; ok {
				continue
			}
			seen[uid] = struct{}{}
			targets = append(targets, uid)
		}
	}
	h.mu.RUnlock()
	h.BroadcastToUsers(targets, msg)
}

// BroadcastToRoles отправляет сообщение всем пользователям с указанными ролями.
func (h *NotifyHub) BroadcastToRoles(roles []string, msg []byte) {
	seen := make(map[uuid.UUID]struct{})
	var targets []uuid.UUID
	h.mu.RLock()
	for _, role := range roles {
		if role == "" {
			continue
		}
		m := h.roles[role]
		for uid := range m {
			if _, ok := seen[uid]; ok {
				continue
			}
			seen[uid] = struct{}{}
			targets = append(targets, uid)
		}
	}
	h.mu.RUnlock()
	h.BroadcastToUsers(targets, msg)
}

func (c *ClientConn) WritePump() {
	defer c.Conn.Close()
	for msg := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

type IncomingMessage struct {
	SubscribeSession   string `json:"subscribe_session"`
	UnsubscribeSession string `json:"unsubscribe_session"`
}

func (c *ClientConn) ReadPump(hub *NotifyHub, userID uuid.UUID) {
	defer c.Conn.Close()
	for {
		_, data, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}
		var msg IncomingMessage
		_ = json.Unmarshal(data, &msg)
		if msg.SubscribeSession != "" {
			if sid, err := uuid.Parse(msg.SubscribeSession); err == nil {
				hub.SubscribeSession(sid, userID)
			}
		}
		if msg.UnsubscribeSession != "" {
			if sid, err := uuid.Parse(msg.UnsubscribeSession); err == nil {
				hub.UnsubscribeSession(sid, userID)
			}
		}
	}
}
