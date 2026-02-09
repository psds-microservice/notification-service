declare module 'uWebSockets.js' {
  type HttpRequest = unknown;
  type HttpResponse = unknown;

  interface WebSocket {
    send(message: ArrayBuffer | string, isBinary?: boolean): void;
    end(): void;
    close(): void;
  }

  interface WebSocketBehavior {
    upgrade?: (res: HttpResponse, req: HttpRequest, context: unknown) => void;
    open?: (ws: WebSocket) => void;
    message?: (ws: WebSocket, message: ArrayBuffer, isBinary: boolean) => void;
    close?: (ws: WebSocket, code: number, message: ArrayBuffer) => void;
  }

  interface App {
    ws(pattern: string, behavior: WebSocketBehavior): App;
    listen(host: string, port: number, cb: (token: unknown) => void): void;
  }

  function App(): App;

  export = { App };
}
