import type { IWsConnection } from '../notifyHub.js';

type UwsWs = {
  send(message: ArrayBuffer | string, isBinary?: boolean): void;
  end(): void;
  close(): void;
};

/**
 * Adapts uWebSockets.js WebSocket to IWsConnection.
 * Call notifyClose() from behavior.close callback.
 */
export function createUwsAdapter(ws: UwsWs): IWsConnection & { notifyClose(): void } {
  let closed = false;
  let onCloseCb: (() => void) | null = null;

  return {
    send(msg: string | Buffer): void {
      if (closed) return;
      const data = typeof msg === 'string' ? Buffer.from(msg, 'utf8') : msg;
      try {
        ws.send(data, false);
      } catch {
        // ignore
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        ws.end();
      } catch {
        // ignore
      }
      onCloseCb?.();
    },
    setOnClose(cb: () => void): void {
      onCloseCb = cb;
    },
    isOpen(): boolean {
      return !closed;
    },
    notifyClose(): void {
      if (closed) return;
      closed = true;
      onCloseCb?.();
    },
  };
}
