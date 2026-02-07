import type { WebSocket } from 'ws';

export interface EventMessage {
  event: string;
  payload?: unknown;
}

const defaultSendBufferSize = 256;

export class NotifyHub {
  private users = new Map<string, ClientConn>();
  private sessions = new Map<string, Set<string>>();

  register(userId: string, ws: WebSocket): ClientConn {
    const existing = this.users.get(userId);
    if (existing) {
      existing.close();
      this.users.delete(userId);
    }
    const conn = new ClientConn(userId, ws, defaultSendBufferSize);
    this.users.set(userId, conn);
    conn.onClose = () => this.unregister(userId);
    return conn;
  }

  unregister(userId: string): void {
    const conn = this.users.get(userId);
    if (conn) {
      conn.close();
      this.users.delete(userId);
    }
    for (const userSet of this.sessions.values()) {
      userSet.delete(userId);
    }
  }

  subscribeSession(sessionId: string, userId: string): void {
    let set = this.sessions.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessions.set(sessionId, set);
    }
    set.add(userId);
  }

  unsubscribeSession(sessionId: string, userId: string): void {
    const set = this.sessions.get(sessionId);
    if (set) set.delete(userId);
  }

  broadcastToSession(sessionId: string, msg: string | Buffer): void {
    const userIds = this.sessions.get(sessionId);
    if (!userIds) return;
    for (const uid of userIds) {
      const conn = this.users.get(uid);
      if (conn?.sendSafe) conn.sendSafe(msg);
    }
  }

  sendToUser(userId: string, msg: string | Buffer): void {
    const conn = this.users.get(userId);
    if (conn?.sendSafe) conn.sendSafe(msg);
  }
}

export class ClientConn {
  onClose?: () => void;
  private queue: (string | Buffer)[] = [];
  private closed = false;

  constructor(
    public readonly userId: string,
    private ws: WebSocket,
    private readonly maxQueue: number
  ) {
    ws.on('close', () => {
      this.closed = true;
      this.onClose?.();
    });
  }

  sendSafe(msg: string | Buffer): void {
    if (this.closed) return;
    if (this.queue.length >= this.maxQueue) return;
    this.queue.push(msg);
    this.flush();
  }

  private flush(): void {
    while (this.queue.length > 0 && this.ws.readyState === 1) {
      const msg = this.queue.shift();
      if (msg !== undefined) this.ws.send(msg);
    }
  }

  close(): void {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}
