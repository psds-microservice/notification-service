import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { NotifyHub } from '../notifyHub.js';

export async function notifyRoutes(
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & { hub: NotifyHub }
): Promise<void> {
  const { hub } = opts;

  fastify.post<{
    Params: { id: string };
    Body: { event: string; payload?: unknown };
  }>('/notify/session/:id', async (request, reply) => {
    const id = request.params.id;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return reply.status(400).send({ error: 'invalid session id' });
    }
    const body = request.body;
    if (!body || typeof body.event !== 'string' || body.event === '') {
      return reply.status(400).send({ error: 'event required' });
    }
    const msg = JSON.stringify({
      event: body.event,
      payload: body.payload,
    });
    hub.broadcastToSession(id, msg);
    return reply.send({ ok: true });
  });
}
