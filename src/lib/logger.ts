import winston from 'winston';
import path from 'path';

const LOGS_DIR = process.env.LOGS_DIR || './logs';

/**
 * Application-level logger using Winston.
 * Writes to both console and file (./logs/vectorforge.log).
 */
export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'vectorforge' },
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      ),
    }),
    // File output
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'vectorforge.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    // Error-only file
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

/**
 * Create a processing log entry for batch operations.
 * This is written to the per-batch processing-log.txt file.
 */
export function formatProcessingLogEntry(data: {
  timestamp: string;
  originalFilename: string;
  baseName: string;
  sku: string;
  upscaleApplied: string;
  conversionSteps: string[];
  warnings: string[];
  status: string;
}): string {
  const lines = [
    `[${data.timestamp}]`,
    `  Original File: ${data.originalFilename}`,
    `  Base Name: ${data.baseName}`,
    `  SKU: ${data.sku}`,
    `  Upscale: ${data.upscaleApplied}`,
    `  Conversion Steps:`,
    ...data.conversionSteps.map((step) => `    - ${step}`),
  ];

  if (data.warnings.length > 0) {
    lines.push(`  Warnings:`);
    data.warnings.forEach((w) => lines.push(`    ⚠ ${w}`));
  }

  lines.push(`  Status: ${data.status}`);
  lines.push('---');

  return lines.join('\n');
}

export default logger;