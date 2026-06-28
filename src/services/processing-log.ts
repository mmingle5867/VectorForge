/**
 * VectorForge - Per-Batch Processing Log Service
 * Creates a detailed processing-log.txt for each batch output folder.
 * Records: timestamp, original filename, base name, SKU, upscale applied,
 * conversion steps, warnings/errors, and final status.
 */

import path from 'path';
import fs from 'fs/promises';
import { logger, formatProcessingLogEntry } from '@/lib/logger';
import config from '@/lib/config';

export interface ProcessingLogEntry {
  originalFilename: string;
  baseName: string;
  sku: string;
  upscaleApplied: boolean;
  upscaleFactor: number;
  conversionSteps: string[];
  warnings: string[];
  errors: string[];
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL';
  processingTimeMs: number;
}

/**
 * Append a processing log entry to the batch's processing-log.txt.
 */
export async function appendToProcessingLog(
  outputDir: string,
  entry: ProcessingLogEntry
): Promise<void> {
  const logPath = path.join(outputDir, 'processing-log.txt');
  const timestamp = new Date().toISOString();

  const formattedEntry = formatProcessingLogEntry({
    timestamp,
    originalFilename: entry.originalFilename,
    baseName: entry.baseName,
    sku: entry.sku,
    upscaleApplied: entry.upscaleApplied
      ? `Yes (${entry.upscaleFactor}x)`
      : 'No (above threshold)',
    conversionSteps: entry.conversionSteps,
    warnings: [...entry.warnings, ...entry.errors],
    status: `${entry.status} (${entry.processingTimeMs}ms)`,
  });

  try {
    // Check if file exists, if not create with header
    try {
      await fs.access(logPath);
    } catch {
      const header = `================================================================================
${config.identity.displayName.toUpperCase()} - BATCH PROCESSING LOG
================================================================================
Generated: ${timestamp}
================================================================================

`;
      await fs.writeFile(logPath, header, 'utf-8');
    }

    // Append the entry
    await fs.appendFile(logPath, formattedEntry + '\n', 'utf-8');
    logger.debug(`Processing Log: Entry appended for ${entry.baseName}`);
  } catch (error) {
    logger.error(`Processing Log: Failed to write entry`, {
      error: error instanceof Error ? error.message : String(error),
      outputDir,
    });
  }
}

/**
 * Finalize the processing log with a summary section.
 */
export async function finalizeProcessingLog(
  outputDir: string,
  summary: {
    totalItems: number;
    completed: number;
    failed: number;
    totalTimeMs: number;
  }
): Promise<void> {
  const logPath = path.join(outputDir, 'processing-log.txt');
  const timestamp = new Date().toISOString();

  const summarySection = `
================================================================================
BATCH SUMMARY
================================================================================
Completed At: ${timestamp}
Total Items:  ${summary.totalItems}
Successful:   ${summary.completed}
Failed:       ${summary.failed}
Total Time:   ${(summary.totalTimeMs / 1000).toFixed(2)}s
================================================================================
`;

  try {
    await fs.appendFile(logPath, summarySection, 'utf-8');
    logger.info(`Processing Log: Finalized with summary`, { outputDir });
  } catch (error) {
    logger.error(`Processing Log: Failed to finalize`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default { appendToProcessingLog, finalizeProcessingLog };
