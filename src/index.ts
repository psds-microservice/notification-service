// eslint-disable-next-line @typescript-eslint/no-require-imports
const uWS = require('uWebSockets.js') as typeof import('uWebSockets.js');
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { createPool, closePool, getPool, insertPendingNotification } from './db/index.js';
import { NotifyHub } from './notifyHub.js';
import { healthRoutes } from './routes/health.js';
import { notifyRoutes } from './routes/notify.js';
import { runKafkaConsumer } from './kafka/consumer.js';
import { createLocalDeliver, createRedisClient, publishNotification } from './redis/index.js';
import type { NotificationMessage } from './redis/pubsub.js';
import { handleNotifyMessage, parseUserIdFromPath } from './ws/notifyHandler.js';
import { createUwsAdapter } from './ws/uwsAdapter.js';
import { createConnectionLimits } from './ws/connectionLimits.js';

function getClientIp(req: { getHeader: (n: string) => string }): string {
  const forwarded = req.getHeader('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.getHeader('x-real-ip');
  return real || 'unknown';
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.db) {
    createPool(config.db);
  }
  const dbPool = getPool();

  const hub = new NotifyHub({
    sendQueueSize: config.wsSendQueueSize,
    onDrop: (userId) => {
      console.warn('[notify] dropped message (queue full) for user', userId);
    },
  });

  hub.onOfflineDelivery = (userId: string, msg: string | Buffer) => {
    let event_type = 'notification';
    let payload: unknown = typeof msg === 'string' ? msg : msg.toString('utf8');
    try {
      const raw = typeof msg === 'string' ? msg : msg.toString('utf8');
      const o = JSON.parse(raw) as { event?: string; payload?: unknown };
      event_type = typeof o.event === 'string' ? o.event : event_type;
      payload = o.payload !== undefined ? o.payload : o;
    } catch {
      // keep defaults
    }
    insertPendingNotification(dbPool, { user_id: userId, event_type, payload }).catch(
      () => {}
    );
  };

  const localDeliver = createLocalDeliver(hub, dbPool);
  const redisClient = await createRedisClient(config.redisUrl, localDeliver);
  const deliverNotification = async (msg: NotificationMessage): Promise<void> => {
    if (redisClient) {
      await publishNotification(redisClient, msg);
    } else {
      await localDeliver(msg);
    }
  };

  const limits = createConnectionLimits({
    maxPerIp: config.wsMaxConnectionsPerIp,
    maxTotal: config.wsMaxConnectionsTotal,
  });

  const fastify = Fastify({ logger: { level: config.logLevel } });
  await fastify.register(healthRoutes);
  await fastify.register(notifyRoutes, { hub, dbPool, deliverNotification });

  await fastify.listen({
    host: config.appHost,
    port: config.port,
  });

  const wsApp = uWS.App().ws('/ws/notify/:user_id', {
    upgrade: (res: unknown, req: unknown, context: unknown) => {
      const r = req as { getUrl: () => string; getHeader: (n: string) => string };
      const resp = res as {
        upgrade: (ctx: unknown, k: string, p: string, e: string, c: unknown) => void;
        writeStatus: (s: string) => { writeHeader: (k: string, v: string) => { end: (b?: string) => void }; end: (b?: string) => void };
      };
      const url = r.getUrl();
      const userId = parseUserIdFromPath(url);
      if (!userId) {
        resp.writeStatus('400 Bad Request').end('invalid user_id');
        return;
      }
      const clientIp = getClientIp(r);
      if (!limits.tryAcquire(clientIp)) {
        resp.writeStatus('503 Service Unavailable').end('connection limit exceeded');
        return;
      }
      resp.upgrade(
        { userId, clientIp },
        r.getHeader('sec-websocket-key'),
        r.getHeader('sec-websocket-protocol') || '',
        r.getHeader('sec-websocket-extensions') || '',
        context
      );
    },
    open: (ws: unknown) => {
      const w = ws as { userId: string; clientIp: string; send: (m: ArrayBuffer | string, b: boolean) => void; end: () => void; __adapter?: ReturnType<typeof createUwsAdapter> };
      const userId = w.userId;
      if (!userId) return;
      const adapter = createUwsAdapter({
        send: (m, b) => w.send(m, b ?? false),
        end: () => w.end(),
        close: () => w.end(),
      });
      (w as { __adapter?: ReturnType<typeof createUwsAdapter> }).__adapter = adapter;
      hub.register(userId, adapter);
    },
    message: (ws: unknown, message: ArrayBuffer, _isBinary: boolean) => {
      const w = ws as { userId: string };
      const userId = w.userId;
      if (!userId) return;
      const text = Buffer.from(message).toString('utf8');
      handleNotifyMessage(hub, userId, text);
    },
    close: (ws: unknown) => {
      const w = ws as { userId?: string; clientIp?: string; __adapter?: { notifyClose(): void } };
      w.__adapter?.notifyClose();
      if (w.clientIp) limits.release(w.clientIp);
    },
  });

  wsApp.listen(config.appHost, config.wsPort, (token: unknown) => {
    if (!token) {
      console.error('Failed to listen on WebSocket port', config.wsPort);
    }
  });

  const stopKafka = await runKafkaConsumer(
    {
      brokers: config.kafkaBrokers,
      groupId: config.kafkaGroupId,
      topics: config.kafkaTopics,
    },
    deliverNotification
  );

  const shutdown = async (): Promise<void> => {
    await stopKafka();
    if (redisClient) await redisClient.close();
    await fastify.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
