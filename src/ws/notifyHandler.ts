import type { NotifyHub } from '../notifyHub.js';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Parse user_id from uWS path /ws/notify/:user_id */
export function parseUserIdFromPath(path: string): string | null {
  const prefix = '/ws/notify/';
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const end = rest.includes('?') ? rest.indexOf('?') : rest.length;
  const userId = rest.slice(0, end).trim();
  return uuidRegex.test(userId) ? userId : null;
}

interface IncomingMsg {
  subscribe_session?: string;
  unsubscribe_session?: string;
}

export function handleNotifyMessage(
  hub: NotifyHub,
  userId: string,
  data: string | Buffer
): void {
  let obj: IncomingMsg;
  try {
    const raw = typeof data === 'string' ? data : data.toString('utf8');
    obj = JSON.parse(raw) as IncomingMsg;
  } catch {
    return;
  }
  if (obj.subscribe_session && uuidRegex.test(obj.subscribe_session)) {
    hub.subscribeSession(obj.subscribe_session, userId);
  }
  if (obj.unsubscribe_session && uuidRegex.test(obj.unsubscribe_session)) {
    hub.unsubscribeSession(obj.unsubscribe_session, userId);
  }
}
