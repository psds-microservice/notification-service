import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { loadConfig } from './config.js';
import { NotifyHub } from './notifyHub.js';
import { healthRoutes } from './routes/health.js';
import { notifyRoutes } from './routes/notify.js';
import { runKafkaConsumer } from './kafka/consumer.js';
import { handleNotifyMessage } from './ws/notifyHandler.js';

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const config = loadConfig();
  const hub = new NotifyHub();

  const fastify = Fastify({ logger: { level: config.logLevel } });
  await fastify.register(fastifyWebsocket);
  await fastify.register(healthRoutes);
  await fastify.register(notifyRoutes, { hub });

  fastify.get<{ Params: { user_id: string } }>(
    '/ws/notify/:user_id',
    { websocket: true },
    (socket, request) => {
      const userId = request.params.user_id?.trim();
      if (!userId || !uuidRegex.test(userId)) {
        socket.close();
        return;
      }
      hub.register(userId, socket);
      socket.on('message', (data: Buffer) => {
        handleNotifyMessage(hub, userId, data);
      });
      socket.on('close', () => {
        hub.unregister(userId);
      });
    }
  );

  await fastify.listen({
    host: config.appHost,
    port: config.port,
  });

  const stopKafka = await runKafkaConsumer(
    {
      brokers: config.kafkaBrokers,
      groupId: config.kafkaGroupId,
      topics: config.kafkaTopics,
    },
    hub
  );

  const shutdown = async (): Promise<void> => {
    await stopKafka();
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
