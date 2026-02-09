import type { Pool } from 'pg';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { NotifyHub } from '../notifyHub.js';
import type { NotificationMessage } from '../redis/pubsub.js';
import { getAndClearPending } from '../db/index.js';

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeliverNotificationFn = (msg: NotificationMessage) => Promise<void>;

export async function notifyRoutes(
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & {
    hub: NotifyHub;
    dbPool: Pool | null;
    deliverNotification: DeliverNotificationFn;
  }
): Promise<void> {
  const { hub, dbPool, deliverNotification } = opts;

  fastify.post<{
    Params: { id: string };
    Body: { event: string; payload?: unknown };
  }>('/notify/session/:id', async (request, reply) => {
    const id = request.params.id;
    if (!uuidRegex.test(id)) {
      return reply.status(400).send({ error: 'invalid session id' });
    }
    const body = request.body;
    if (!body || typeof body.event !== 'string' || body.event === '') {
      return reply.status(400).send({ error: 'event required' });
    }
    const payloadStr = JSON.stringify({
      event: body.event,
      payload: body.payload,
    });
    const msg: NotificationMessage = {
      session_id: id,
      payload: payloadStr,
      event_type: body.event,
      payload_for_db: body.payload,
    };
    await deliverNotification(msg);
    return reply.send({ ok: true });
  });

  /** Слушатели сессии: user_id, подписанные на эту сессию по WebSocket */
  fastify.get<{ Params: { id: string } }>(
    '/notify/session/:id/listeners',
    async (request, reply) => {
      const id = request.params.id;
      if (!uuidRegex.test(id)) {
        return reply.status(400).send({ error: 'invalid session id' });
      }
      const listeners = hub.getSessionListeners(id);
      return reply.send({ session_id: id, listeners });
    }
  );

  /** Fallback push: непрочитанные уведомления для user_id (после выдачи удаляются) */
  fastify.get<{ Params: { user_id: string } }>(
    '/notify/pending/:user_id',
    async (request, reply) => {
      const userId = request.params.user_id;
      if (!uuidRegex.test(userId)) {
        return reply.status(400).send({ error: 'invalid user id' });
      }
      const items = await getAndClearPending(dbPool, userId);
      return reply.send({ user_id: userId, pending: items });
    }
  );
}
