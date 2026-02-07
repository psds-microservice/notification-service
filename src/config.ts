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

export interface Config {
  appEnv: string;
  appHost: string;
  port: number;
  logLevel: string;
  kafkaBrokers: string[];
  kafkaGroupId: string;
  kafkaTopics: string[];
}

export function loadConfig(): Config {
  const brokers = getEnv('KAFKA_BROKERS', 'localhost:9092');
  const topics = getEnv(
    'KAFKA_TOPICS',
    'psds.session.created,psds.session.ended,psds.session.operator_joined,psds.operator.assigned'
  );
  return {
    appEnv: getEnv('APP_ENV', 'development'),
    appHost: getEnv('APP_HOST', '0.0.0.0'),
    port: getEnvInt('APP_PORT', 8092),
    logLevel: getEnv('LOG_LEVEL', 'info'),
    kafkaBrokers: brokers.split(',').map((s) => s.trim()).filter(Boolean),
    kafkaGroupId: getEnv('KAFKA_GROUP_ID', 'notification-service'),
    kafkaTopics: topics.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
