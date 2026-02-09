import type { LocalDeliverFn, NotificationMessage } from './pubsub.js';
import { NOTIFICATION_CHANNEL } from './pubsub.js';

export type RedisClient = {
  publish: (channel: string, message: string) => Promise<void>;
  subscribe: (channel: string, onMessage: (msg: NotificationMessage) => void) => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Create Redis pub/sub client. Returns null if redisUrl is empty.
 * Uses dynamic import so ioredis is optional (only when REDIS_URL is set).
 */
export async function createRedisClient(
  redisUrl: string | null,
  localDeliver: LocalDeliverFn
): Promise<RedisClient | null> {
  if (!redisUrl || redisUrl === '') return null;
  try {
    const Redis = (await import('ioredis')).default;
    const pub = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
    const sub = new Redis(redisUrl, { maxRetriesPerRequest: 3 });

    sub.subscribe(NOTIFICATION_CHANNEL, (err) => {
      if (err) console.error('[redis] subscribe error:', err);
    });
    sub.on('message', (channel: string, message: string) => {
      if (channel !== NOTIFICATION_CHANNEL) return;
      try {
        const msg = JSON.parse(message) as NotificationMessage;
        localDeliver(msg).catch((e) => console.error('[redis] localDeliver error:', e));
      } catch (e) {
        console.error('[redis] invalid message:', e);
      }
    });

    return {
      async publish(channel: string, message: string): Promise<void> {
        await pub.publish(channel, message);
      },
      async subscribe(_channel: string, _onMessage: (msg: NotificationMessage) => void): Promise<void> {
        // already subscribed above; onMessage is handled in sub.on('message')
      },
      async close(): Promise<void> {
        await pub.quit();
        await sub.quit();
      },
    };
  } catch (err) {
    console.error('[redis] failed to connect:', err);
    return null;
  }
}

export async function publishNotification(
  redis: RedisClient | null,
  msg: NotificationMessage
): Promise<void> {
  if (!redis) return;
  await redis.publish(NOTIFICATION_CHANNEL, JSON.stringify(msg));
}
