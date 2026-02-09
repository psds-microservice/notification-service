import type { Pool } from 'pg';
import type { NotifyHub } from '../notifyHub.js';
import { insertNotificationEvent } from '../db/index.js';

export const NOTIFICATION_CHANNEL = 'psds:notification';

export interface NotificationMessage {
  session_id?: string;
  user_id?: string;
  payload: string;
  event_type: string;
  payload_for_db?: unknown;
}

export type PublishNotificationFn = (msg: NotificationMessage) => Promise<void>;
export type LocalDeliverFn = (msg: NotificationMessage) => Promise<void>;

/**
 * Delivers notification locally: hub.broadcastToSession / sendToUser + insertNotificationEvent.
 * Used by Redis subscriber and by single-instance path.
 */
export function createLocalDeliver(
  hub: NotifyHub,
  dbPool: Pool | null
): LocalDeliverFn {
  return async (msg: NotificationMessage): Promise<void> => {
    if (msg.session_id) {
      hub.broadcastToSession(msg.session_id, msg.payload);
    }
    if (msg.user_id) {
      hub.sendToUser(msg.user_id, msg.payload);
    }
    await insertNotificationEvent(dbPool, {
      session_id: msg.session_id ?? null,
      user_id: msg.user_id ?? null,
      event_type: msg.event_type.slice(0, 64),
      payload: msg.payload_for_db ?? msg.payload,
    });
  };
}
