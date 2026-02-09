/** Abstract connection: works with ws or uWebSockets.js */
export interface IWsConnection {
  send(msg: string | Buffer): void;
  close(): void;
  setOnClose(cb: () => void): void;
  isOpen(): boolean;
}

export interface EventMessage {
  event: string;
  payload?: unknown;
}

export type OfflineDeliveryHandler = (userId: string, msg: string | Buffer) => void;
/** Called when send queue is full and message is dropped. */
export type OnDropHandler = (userId: string) => void;

export interface NotifyHubOptions {
  /** Max messages queued per connection before dropping (default 256). */
  sendQueueSize?: number;
  /** Called when a message is dropped due to full queue. */
  onDrop?: OnDropHandler;
}

export class NotifyHub {
  private users = new Map<string, ClientConn>();
  private sessions = new Map<string, Set<string>>();
  private readonly sendQueueSize: number;
  /** Called when message could not be delivered (user offline). Persist for fallback push. */
  onOfflineDelivery?: OfflineDeliveryHandler;
  onDrop?: OnDropHandler;

  constructor(options: NotifyHubOptions = {}) {
    this.sendQueueSize = options.sendQueueSize ?? 256;
    this.onDrop = options.onDrop;
  }

  register(userId: string, conn: IWsConnection): ClientConn {
    const existing = this.users.get(userId);
    if (existing) {
      existing.close();
      this.users.delete(userId);
    }
    const client = new ClientConn(userId, conn, this.sendQueueSize, () => this.onDrop?.(userId));
    this.users.set(userId, client);
    conn.setOnClose(() => this.unregister(userId));
    return client;
  }

  /** Total number of connected users (WebSocket connections). */
  getConnectionCount(): number {
    return this.users.size;
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

  /** Returns user_ids currently subscribed to this session (listeners). */
  getSessionListeners(sessionId: string): string[] {
    const set = this.sessions.get(sessionId);
    return set ? Array.from(set) : [];
  }

  broadcastToSession(sessionId: string, msg: string | Buffer): void {
    const userIds = this.sessions.get(sessionId);
    if (!userIds) return;
    for (const uid of userIds) {
      const conn = this.users.get(uid);
      if (conn?.sendSafe) {
        conn.sendSafe(msg);
      } else {
        this.onOfflineDelivery?.(uid, msg);
      }
    }
  }

  sendToUser(userId: string, msg: string | Buffer): void {
    const conn = this.users.get(userId);
    if (conn?.sendSafe) {
      conn.sendSafe(msg);
    } else {
      this.onOfflineDelivery?.(userId, msg);
    }
  }

  isUserConnected(userId: string): boolean {
    return this.users.has(userId);
  }
}

export class ClientConn {
  onClose?: () => void;
  private queue: (string | Buffer)[] = [];
  private closed = false;
  private readonly onDrop: (() => void) | undefined;

  constructor(
    public readonly userId: string,
    private conn: IWsConnection,
    private readonly maxQueue: number,
    onDrop?: () => void
  ) {
    this.onDrop = onDrop;
  }

  sendSafe(msg: string | Buffer): void {
    if (this.closed) return;
    if (this.queue.length >= this.maxQueue) {
      this.onDrop?.();
      return;
    }
    this.queue.push(msg);
    this.flush();
  }

  private flush(): void {
    while (this.queue.length > 0 && this.conn.isOpen()) {
      const msg = this.queue.shift();
      if (msg !== undefined) this.conn.send(msg);
    }
  }

  close(): void {
    this.closed = true;
    try {
      this.conn.close();
    } catch {
      // ignore
    }
  }
}
