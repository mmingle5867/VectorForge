import 'dotenv/config';
import { logger } from '../lib/logger';
import { probeRedisConnection } from '../lib/queue';
import { serializeError } from '../lib/error-utils';

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  const redisProbe = await probeRedisConnection(3000);

  if (!redisProbe.ok) {
    const details = serializeError(redisProbe.error);
    if (isProduction || process.env.REDIS_REQUIRED === 'true') {
      logger.error('Redis required but unavailable, worker cannot start', details);
      process.exit(1);
    }

    logger.warn('Redis unavailable, worker disabled in local development', details);
    process.exit(0);
  }

  logger.info('Redis connected, starting processing worker');
  await import('./processing-worker');
}

void main().catch((error) => {
  logger.error('Worker bootstrap failed', serializeError(error));
  process.exit(1);
});
