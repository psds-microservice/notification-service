import { Pool, type PoolClient } from 'pg';
import type { DbConfig } from '../config.js';

let pool: Pool | null = null;

export interface NotificationEventRow {
  session_id: string | null;
  user_id: string | null;
  event_type: string;
  payload: unknown;
}

export function createPool(config: DbConfig): Pool {
  pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  return pool;
}

export function getPool(): Pool | null {
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function insertNotificationEvent(
  client: Pool | PoolClient | null,
  row: NotificationEventRow
): Promise<void> {
  if (!client) return;
  const { session_id, user_id, event_type, payload } = row;
  const payloadJson =
    payload === undefined || payload === null ? null : JSON.stringify(payload);
  try {
    await client.query(
      `INSERT INTO notification_events (session_id, user_id, event_type, payload)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)`,
      [
        session_id ?? null,
        user_id ?? null,
        event_type.slice(0, 64),
        payloadJson,
      ]
    );
  } catch (err) {
    console.error('[db] insertNotificationEvent failed:', err);
  }
}

export interface PendingNotificationRow {
  user_id: string;
  event_type: string;
  payload: unknown;
}

export async function insertPendingNotification(
  client: Pool | PoolClient | null,
  row: PendingNotificationRow
): Promise<void> {
  if (!client) return;
  const payloadJson =
    row.payload === undefined || row.payload === null
      ? null
      : JSON.stringify(row.payload);
  try {
    await client.query(
      `INSERT INTO notification_pending (user_id, event_type, payload)
       VALUES ($1::uuid, $2, $3::jsonb)`,
      [row.user_id, row.event_type.slice(0, 64), payloadJson]
    );
  } catch (err) {
    console.error('[db] insertPendingNotification failed:', err);
  }
}

export interface PendingItem {
  id: string;
  user_id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
}

export async function getAndClearPending(
  client: Pool | PoolClient | null,
  userId: string
): Promise<PendingItem[]> {
  if (!client) return [];
  try {
    const res = await client.query<{
      id: string;
      user_id: string;
      event_type: string;
      payload: unknown;
      created_at: string;
    }>(
      `SELECT id, user_id, event_type, payload, created_at
       FROM notification_pending WHERE user_id = $1::uuid ORDER BY created_at`,
      [userId]
    );
    const rows = res.rows ?? [];
    await client.query(
      `DELETE FROM notification_pending WHERE user_id = $1::uuid`,
      [userId]
    );
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      event_type: r.event_type,
      payload: r.payload,
      created_at: r.created_at,
    }));
  } catch (err) {
    console.error('[db] getAndClearPending failed:', err);
    return [];
  }
}
