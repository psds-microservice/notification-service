import { Kafka } from 'kafkajs';
import type { NotifyHub } from '../notifyHub.js';

export interface KafkaConfig {
  brokers: string[];
  groupId: string;
  topics: string[];
}

export async function runKafkaConsumer(
  config: KafkaConfig,
  hub: NotifyHub
): Promise<() => Promise<void>> {
  if (config.brokers.length === 0 || config.topics.length === 0) {
    return async () => {};
  }
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
      const payload = value.toString();
      try {
        const obj = JSON.parse(payload) as { session_id?: string; user_id?: string; event?: string };
        const sessionId = obj.session_id ?? (obj as { sessionId?: string }).sessionId;
        if (sessionId && typeof sessionId === 'string') {
          hub.broadcastToSession(sessionId, payload);
        }
        const userId = obj.user_id ?? (obj as { userId?: string }).userId;
        if (userId && typeof userId === 'string') {
          hub.sendToUser(userId, payload);
        }
      } catch {
        // skip invalid JSON
      }
    },
  });
  return async () => {
    await consumer.disconnect();
  };
}
