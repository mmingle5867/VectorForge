import { Queue, Job, QueueEvents, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from './logger';
import { serializeError } from './error-utils';
import config from './config';

// =============================================================================
// Redis Connection
// =============================================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_LOG_THROTTLE_MS = 60_000;
const isProduction = process.env.NODE_ENV === 'production';
const PROCESSING_QUEUE_NAME = `${config.identity.slug}-processing`;
const ZIP_QUEUE_NAME = `${config.identity.slug}-zip`;

/**
 * Shared Redis connection for BullMQ.
 * Used by both the queue (producer) and worker (consumer).
 */
let redisClient: IORedis | null = null;
let redisReadyLogged = false;
let redisOfflineLogged = false;
let lastRedisErrorLogAt = 0;

/**
 * Cast to ConnectionOptions to handle ioredis version mismatch between
 * top-level ioredis and bullmq's bundled ioredis types.
 */
export function getRedisConnection(): ConnectionOptions {
  if (!redisClient) {
    redisClient = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisClient.on('ready', () => {
      if (!redisReadyLogged) {
        redisReadyLogged = true;
        logger.info('Redis connected', {
          mode: isProduction ? 'production' : 'development',
        });
      }
    });

    redisClient.on('error', (err) => {
      const details = serializeError(err);
      const now = Date.now();

      if (!isProduction) {
        if (!redisOfflineLogged) {
          redisOfflineLogged = true;
          logger.warn('Redis unavailable, worker disabled in local development', details);
        }
        return;
      }

      if (now - lastRedisErrorLogAt >= REDIS_LOG_THROTTLE_MS) {
        lastRedisErrorLogAt = now;
        logger.error('Redis connection error', details);
      }
    });

    redisClient.on('close', () => {
      if (!isProduction && !redisOfflineLogged) {
        logger.warn('Redis connection closed');
      }
    });
  }

  return redisClient as unknown as ConnectionOptions;
}

export async function probeRedisConnection(timeoutMs = 3000): Promise<{ ok: boolean; error?: unknown }> {
  const probe = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy() {
      return null;
    },
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Redis connection timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    await Promise.race([probe.connect(), timeout]);
    await probe.ping();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    try {
      probe.disconnect();
    } catch {
      // Ignore probe shutdown errors.
    }
  }
}

export const redisConnection = new Proxy({} as ConnectionOptions, {
  get(_target, prop, receiver) {
    const connection = getRedisConnection();
    const value = Reflect.get(connection, prop, receiver);
    return typeof value === 'function' ? value.bind(connection) : value;
  },
});

// =============================================================================
// Queue Definitions
// =============================================================================

/**
 * Main processing queue for batch conversion jobs.
 * Each job represents a single BatchItem to be processed.
 */
let processingQueueInstance: Queue | null = null;

export function getProcessingQueue(): Queue {
  if (!processingQueueInstance) {
    processingQueueInstance = new Queue(PROCESSING_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          count: 100, // Keep last 100 completed jobs
        },
        removeOnFail: {
          count: 50, // Keep last 50 failed jobs
        },
      },
    });
  }

  return processingQueueInstance;
}

export const processingQueue = new Proxy({} as Queue, {
  get(_target, prop, receiver) {
    const queue = getProcessingQueue();
    const value = Reflect.get(queue, prop, receiver);
    return typeof value === 'function' ? value.bind(queue) : value;
  },
});

/**
 * ZIP generation queue - runs after all items in a batch are processed.
 */
let zipQueueInstance: Queue | null = null;

export function getZipQueue(): Queue {
  if (!zipQueueInstance) {
    zipQueueInstance = new Queue(ZIP_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 3000,
        },
        removeOnComplete: {
          count: 50,
        },
        removeOnFail: {
          count: 20,
        },
      },
    });
  }

  return zipQueueInstance;
}

export const zipQueue = new Proxy({} as Queue, {
  get(_target, prop, receiver) {
    const queue = getZipQueue();
    const value = Reflect.get(queue, prop, receiver);
    return typeof value === 'function' ? value.bind(queue) : value;
  },
});

// =============================================================================
// Queue Events (for SSE progress tracking)
// =============================================================================

let processingQueueEventsInstance: QueueEvents | null = null;

export function getProcessingQueueEvents(): QueueEvents {
  if (!processingQueueEventsInstance) {
    processingQueueEventsInstance = new QueueEvents(PROCESSING_QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }

  return processingQueueEventsInstance;
}

export const processingQueueEvents = new Proxy({} as QueueEvents, {
  get(_target, prop, receiver) {
    const queueEvents = getProcessingQueueEvents();
    const value = Reflect.get(queueEvents, prop, receiver);
    return typeof value === 'function' ? value.bind(queueEvents) : value;
  },
});

let zipQueueEventsInstance: QueueEvents | null = null;

export function getZipQueueEvents(): QueueEvents {
  if (!zipQueueEventsInstance) {
    zipQueueEventsInstance = new QueueEvents(ZIP_QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }

  return zipQueueEventsInstance;
}

export const zipQueueEvents = new Proxy({} as QueueEvents, {
  get(_target, prop, receiver) {
    const queueEvents = getZipQueueEvents();
    const value = Reflect.get(queueEvents, prop, receiver);
    return typeof value === 'function' ? value.bind(queueEvents) : value;
  },
});

// =============================================================================
// Job Type Definitions
// =============================================================================

export interface ProcessingJobData {
  batchId: string;
  batchItemId: string;
  userId: string;
  /** Explicit context fields are optional only while legacy producers are migrated. */
  profileId?: string;
  workspaceId?: string;
  originalFilename: string;
  baseName: string;
  uploadPath: string;
  mimeType?: string | null;
  upscaleFactor: number;
  smartUpscaleThreshold: number;
  useBaseAssets: boolean;
  substitutionData: Record<string, string>;
  outputBasePath: string;
  baseAssetsPath: string;
  // Marketplace Preview options
  enableMarketplacePreview: boolean;
  enableColorTint: boolean;
  tintColor: string;
  watermarkOpacity: number;
  backgroundFilename: string;
  watermarkFilename: string;
  pngExportArtworkColor?: string;
  // CNC / Vinyl / Laser mode
  cncMode: boolean;
}

export interface ZipJobData {
  batchId: string;
  userId: string;
  profileId?: string;
  workspaceId?: string;
  outputBasePath: string;
  batchItemIds: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Add a batch item to the processing queue.
 */
export async function enqueueProcessingJob(data: ProcessingJobData): Promise<Job> {
  const job = await getProcessingQueue().add(
    `process-item-${data.batchItemId}`,
    data,
    {
      priority: 1,
    }
  );
  logger.info(`Enqueued processing job for item ${data.batchItemId}`, {
    jobId: job.id,
    batchId: data.batchId,
  });
  return job;
}

/**
 * Add a ZIP generation job to the queue.
 */
export async function enqueueZipJob(data: ZipJobData): Promise<Job> {
  const job = await getZipQueue().add(
    `zip-batch-${data.batchId}`,
    data,
    {
      priority: 2,
    }
  );
  logger.info(`Enqueued ZIP job for batch ${data.batchId}`, { jobId: job.id });
  return job;
}

/**
 * Get the current status of the processing queue.
 */
export async function getQueueStatus() {
  const queue = getProcessingQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}

export default processingQueue;
