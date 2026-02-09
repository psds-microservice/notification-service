import 'dotenv/config';

function getEnv(key: string, def: string): string {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : def;
}

function getEnvInt(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

export interface Config {
  appEnv: string;
  appHost: string;
  port: number;
  wsPort: number;
  logLevel: string;
  /** Max messages queued per WebSocket before dropping (0 = default 256). */
  wsSendQueueSize: number;
  /** Max WebSocket connections per IP (0 = unlimited). */
  wsMaxConnectionsPerIp: number;
  /** Max total WebSocket connections (0 = unlimited). */
  wsMaxConnectionsTotal: number;
  kafkaBrokers: string[];
  kafkaGroupId: string;
  kafkaTopics: string[];
  db: DbConfig | null;
  /** Redis URL for pub/sub (multi-instance). If set, delivery goes via Redis. */
  redisUrl: string | null;
}

export function loadConfig(): Config {
  const brokers = getEnv('KAFKA_BROKERS', 'localhost:9092');
  const topics = getEnv(
    'KAFKA_TOPICS',
    'psds.session.created,psds.session.ended,psds.session.operator_joined,psds.operator.assigned'
  );
  const dbHost = getEnv('DB_HOST', '');
  const db: DbConfig | null =
    dbHost === ''
      ? null
      : {
          host: dbHost,
          port: getEnvInt('DB_PORT', 5432),
          user: getEnv('DB_USER', 'postgres'),
          password: getEnv('DB_PASSWORD', ''),
          database: getEnv('DB_DATABASE', 'notification_service'),
          ssl: getEnv('DB_SSLMODE', 'disable').toLowerCase() === 'require',
        };

  const redisUrl = getEnv('REDIS_URL', '');
  return {
    appEnv: getEnv('APP_ENV', 'development'),
    appHost: getEnv('APP_HOST', '0.0.0.0'),
    port: getEnvInt('APP_PORT', 8092),
    wsPort: getEnvInt('WS_PORT', 8094),
    logLevel: getEnv('LOG_LEVEL', 'info'),
    wsSendQueueSize: getEnvInt('WS_SEND_QUEUE_SIZE', 256) || 256,
    wsMaxConnectionsPerIp: getEnvInt('WS_MAX_CONNECTIONS_PER_IP', 0),
    wsMaxConnectionsTotal: getEnvInt('WS_MAX_CONNECTIONS_TOTAL', 0),
    kafkaBrokers: brokers.split(',').map((s) => s.trim()).filter(Boolean),
    kafkaGroupId: getEnv('KAFKA_GROUP_ID', 'notification-service'),
    kafkaTopics: topics.split(',').map((s) => s.trim()).filter(Boolean),
    db,
    redisUrl: redisUrl === '' ? null : redisUrl,
  };
}
