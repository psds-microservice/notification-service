import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function healthRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  fastify.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'notification-service',
      time: Math.floor(Date.now() / 1000),
    });
  });

  fastify.get('/ready', async (_request, reply) => {
    return reply.send({ ready: true });
  });
}
