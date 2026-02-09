import path from 'node:path';
import { Kafka } from 'kafkajs';
import protobuf from 'protobufjs';
import type { NotificationMessage } from '../redis/pubsub.js';

export interface KafkaConfig {
  brokers: string[];
  groupId: string;
  topics: string[];
}

interface DecodedEvent {
  session_id?: string;
  user_id?: string;
  event?: string;
  payload?: string;
  [key: string]: unknown;
}

let SessionEventType: protobuf.Type | null = null;

async function loadProto(): Promise<protobuf.Type | null> {
  try {
    const fromCwd = path.join(process.cwd(), 'proto', 'session_event.proto');
    const fromDist = path.join(__dirname, '..', '..', 'proto', 'session_event.proto');
    const fs = await import('node:fs');
    const protoPath = fs.existsSync(fromDist) ? fromDist : fromCwd;
    const root = await protobuf.load(protoPath);
    const type = root.lookupType('psds.notification.SessionEvent');
    return type;
  } catch (err) {
    console.error('[kafka] Failed to load proto, using JSON only:', err);
    return null;
  }
}

function decodeMessage(value: Buffer): DecodedEvent | null {
  if (!value || value.length === 0) return null;
  if (SessionEventType) {
    try {
      const msg = SessionEventType.decode(value);
      const obj = SessionEventType.toObject(msg, {
        longs: String,
        enums: String,
        bytes: String,
      }) as DecodedEvent;
      return obj;
    } catch {
      // fallback to JSON
    }
  }
  try {
    const str = value.toString('utf8');
    return JSON.parse(str) as DecodedEvent;
  } catch {
    return null;
  }
}

export type DeliverNotificationFn = (msg: NotificationMessage) => Promise<void>;

export async function runKafkaConsumer(
  config: KafkaConfig,
  deliverNotification: DeliverNotificationFn
): Promise<() => Promise<void>> {
  if (config.brokers.length === 0 || config.topics.length === 0) {
    return async () => {};
  }
  SessionEventType = await loadProto();

  const kafka = new Kafka({
    clientId: 'notification-service',
    brokers: config.brokers,
  });
  const consumer = kafka.consumer({ groupId: config.groupId });
  await consumer.connect();
  for (const topic of config.topics) {
    await consumer.subscribe({ topic, fromBeginning: true });
  }
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const value = message.value;
      if (!value) return;
      const obj = decodeMessage(value);
      if (!obj) return;
      const sessionId = obj.session_id ?? (obj as { sessionId?: string }).sessionId;
      const userId = obj.user_id ?? (obj as { userId?: string }).userId;
      const eventType = (typeof obj.event === 'string' ? obj.event : null) ?? topic;
      const payloadStr =
        typeof obj.payload === 'string'
          ? obj.payload
          : JSON.stringify({ event: eventType, session_id: sessionId, user_id: userId, ...obj });
      const msg: NotificationMessage = {
        session_id: typeof sessionId === 'string' ? sessionId : undefined,
        user_id: typeof userId === 'string' ? userId : undefined,
        payload: payloadStr,
        event_type: eventType.slice(0, 64),
        payload_for_db: obj,
      };
      await deliverNotification(msg);
    },
  });
  return async () => {
    await consumer.disconnect();
  };
}
