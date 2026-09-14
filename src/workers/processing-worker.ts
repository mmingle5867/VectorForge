/**
 * VectorForge - Processing Worker
 * BullMQ worker that processes individual batch items.
 * Pipeline: Smart Upscale → VTracer Conversion → SVGO Optimization → Generate Files → ZIP
 *
 * Run with: npm run worker (or npm run worker:dev for hot reload)
 */

import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import { redisConnection, type ProcessingJobData } from '../lib/queue';
import { serializeError } from '../lib/error-utils';
import prisma from '../lib/prisma';
import { logger } from '../lib/logger';
import { getZipPath } from '../lib/output-naming';
import { isSvgMimeOrPath } from '../lib/svg-normalize';
import { upscaleImage } from '../services/upscaler';
import { convertToSvg } from '../services/conversion';
import { generateMetadataFile } from '../services/metadata';
import { generateSkuFile } from '../services/sku-generator';
import { applyBaseAssets } from '../services/base-assets';
import { appendToProcessingLog, finalizeProcessingLog } from '../services/processing-log';
import { createZipFromFolder } from '../services/zip-generator';
import { generateMarketplacePreview } from '../services/marketplace-preview';
import { exportImportedSvgPackage } from '../services/svg-import-export';
import { upsertGeneratedAssetsForBatchItem } from '../services/sema-identity';
import { getIncrementalFolderName } from '../lib/server-utils';
import { settingsToConversionOptions } from '../lib/vtracer-presets';
import { completeCoreExecution, createCoreCommand, startCoreExecution } from '../services/sema-core';
import config from '../lib/config';
import { resolveSemaAccessContext } from '../services/sema-access-context';

const PROCESSING_QUEUE_NAME = `${config.identity.slug}-processing`;

// ============================================================================
// Worker Definition
// ============================================================================

const processingWorker = new Worker<ProcessingJobData>(
  PROCESSING_QUEUE_NAME,
  async (job: Job<ProcessingJobData>) => {
    const data = job.data;
    const startTime = Date.now();

    logger.info(`Worker: Processing item ${data.batchItemId}`, {
      jobId: job.id,
      batchId: data.batchId,
      baseName: data.baseName,
    });

    let coreExecutionId: string | null = null;
    try {
      // Resolve and verify the job against the same explicit user/workspace
      // context used by foreground commands. Legacy job producers may omit
      // scope fields temporarily; the persisted Batch remains authoritative.
      const batchScope = await prisma.batch.findUniqueOrThrow({
        where: { id: data.batchId },
        select: { userId: true, workspaceId: true },
      });
      if (batchScope.userId !== data.userId) {
        throw new Error('Processing job user does not match its batch owner');
      }
      const accessContext = await resolveSemaAccessContext({
        userId: data.userId,
        profileId: data.profileId,
        workspaceId: data.workspaceId || batchScope.workspaceId || undefined,
      });
      if (batchScope.workspaceId && batchScope.workspaceId !== accessContext.workspaceId) {
        throw new Error('Processing job workspace does not match its batch scope');
      }

      const coreCommand = await createCoreCommand({
        commandType: 'vectorforge.artwork.process',
        actorId: accessContext.userId,
        workspaceId: accessContext.workspaceId,
        context: { profileId: accessContext.profileId, workspaceMembershipId: accessContext.workspaceMembershipId, role: accessContext.role },
        subjectIds: [data.batchId, data.batchItemId],
        payload: { queueJobId: job.id ?? null, baseName: data.baseName },
      });
      const coreExecution = await startCoreExecution({
        commandId: coreCommand.id,
        providerId: 'vectorforge.local.processing-worker',
      });
      coreExecutionId = coreExecution.id;
      // ====================================================================
      // Step 1: Update status to UPSCALING
      // ====================================================================
      await updateItemStatus(data.batchItemId, 'UPSCALING', 10, 'Upscaling image...');

      // Create output directory for this item
      const existingItem = await prisma.batchItem.findUnique({
        where: { id: data.batchItemId },
        select: { outputFolderPath: true, uploadPath: true, baseName: true, mimeType: true },
      });
      const workingUploadPath = existingItem?.uploadPath || data.uploadPath;
      const workingBaseName = existingItem?.baseName || data.baseName;
      const workingMimeType = existingItem?.mimeType || data.mimeType;
      const itemOutputDir = await createOutputDirectory(
        data.outputBasePath,
        workingBaseName,
        existingItem?.outputFolderPath
      );
      if (existingItem?.outputFolderPath !== itemOutputDir) {
        await prisma.batchItem.update({
          where: { id: data.batchItemId },
          data: { outputFolderPath: itemOutputDir },
        });
      }

      if (isSvgMimeOrPath(workingMimeType, workingUploadPath || data.originalFilename)) {
        await job.updateProgress(25);
        await updateItemStatus(data.batchItemId, 'GENERATING_FILES', 25, 'Exporting imported SVG...');

        const originalSvg = await readFile(workingUploadPath, 'utf-8');
        const pngExportArtworkColor = isHexColor(data.pngExportArtworkColor)
          ? data.pngExportArtworkColor
          : isHexColor(config.processing.pngExportArtworkColor)
            ? config.processing.pngExportArtworkColor
            : '#000000';
        const svgExport = await exportImportedSvgPackage(originalSvg, itemOutputDir, {
          pngExportArtworkColor,
          createZip: false,
        });

        await job.updateProgress(75);
        await updateItemStatus(data.batchItemId, 'ZIPPING', 75, 'Creating ZIP bundle...');

        const zipPath = getZipPath(itemOutputDir);
        await createZipFromFolder(itemOutputDir, zipPath);

        const processingTime = Date.now() - startTime;

        await prisma.batchItem.update({
          where: { id: data.batchItemId },
          data: {
            status: 'COMPLETED',
            progress: 100,
            currentStep: null,
            svgPath: svgExport.svgPath,
            outputFolderPath: itemOutputDir,
            zipPath,
            upscaledWidth: svgExport.normalized.width,
            upscaledHeight: svgExport.normalized.height,
            completedAt: new Date(),
          },
        });

        await upsertGeneratedAssetsForBatchItem(data.batchItemId, [
          { role: 'primary-svg', filePath: svgExport.svgPath, mimeType: 'image/svg+xml' },
          { role: 'primary-png', filePath: svgExport.pngPath, mimeType: 'image/png' },
          { role: 'primary-jpg', filePath: svgExport.jpgPath, mimeType: 'image/jpeg' },
          { role: 'customer-zip', filePath: zipPath, mimeType: 'application/zip' },
        ]);

        await appendToProcessingLog(path.dirname(itemOutputDir), {
          originalFilename: data.originalFilename,
          baseName: data.baseName,
          sku: 'N/A',
          upscaleApplied: false,
          upscaleFactor: data.upscaleFactor,
          conversionSteps: [
            'SVG Import: normalized for raster rendering',
            `SVG Export: saved source SVG (${svgExport.files[0]?.size || 0} bytes)`,
            'PNG Export: generated from imported SVG',
            'JPG Export: generated from imported SVG',
            'VTracer: skipped for imported SVG',
            'ZIP: Bundle created',
          ],
          warnings: [],
          errors: [],
          status: 'COMPLETED',
          processingTimeMs: processingTime,
        });

        await updateBatchProgress(data.batchId);
        await job.updateProgress(100);

        logger.info(`Worker: SVG item ${data.batchItemId} completed in ${processingTime}ms`, {
          svgSize: svgExport.files[0]?.size || 0,
        });

        await completeCoreExecution({
          executionId: coreExecutionId,
          status: 'SUCCESS',
          resultType: 'vectorforge.processing.completed',
          subjectIds: [data.batchId, data.batchItemId],
          result: { processingTimeMs: processingTime, svgPath: svgExport.svgPath, zipPath },
        });

        return { success: true, sku: null, processingTime };
      }

      // Smart upscale
      const upscaleResult = await upscaleImage(workingUploadPath, itemOutputDir, {
        factor: data.upscaleFactor as 1 | 2 | 4,
        threshold: data.smartUpscaleThreshold,
        keepOriginal: true,
      });

      await job.updateProgress(25);
      await updateItemStatus(data.batchItemId, 'CONVERTING', 25, 'Converting with VTracer...');

      // ====================================================================
      // Step 1.5: Marketplace Preview (after upscale, before conversion)
      // ====================================================================
      let marketplacePreviewPath: string | null = null;
      if (data.enableMarketplacePreview) {
        const previewSource = upscaleResult.upscaledPath || upscaleResult.originalPath;
        const previewResult = await generateMarketplacePreview(
          previewSource,
          itemOutputDir,
          data.baseName,
          {
            enableColorTint: data.enableColorTint,
            tintColor: data.tintColor,
            watermarkOpacity: data.watermarkOpacity,
            backgroundFilename: data.backgroundFilename,
            watermarkFilename: data.watermarkFilename,
            baseAssetsPath: data.baseAssetsPath,
          }
        );
        if (previewResult) {
          marketplacePreviewPath = previewResult.path;
        }
      }

      // ====================================================================
      // Step 2: VTracer Conversion
      // ====================================================================
      const imageToConvert = upscaleResult.upscaledPath || upscaleResult.originalPath;

      // Get VTracer settings from batch (stored in substitutionData or use defaults)
      const vtracerSettings = data.substitutionData?.__vtracerSettings
        ? JSON.parse(data.substitutionData.__vtracerSettings)
        : null;

      // Apply CNC mode: default to binary/monochrome unless full color is enabled
      const colorMode: 'color' | 'binary' = data.cncMode ? 'binary' : 'color';
      let conversionOptions = vtracerSettings
        ? settingsToConversionOptions(vtracerSettings)
        : undefined;

      if (conversionOptions) {
        conversionOptions = { ...conversionOptions, colorMode };
      } else {
        conversionOptions = {
          colorMode,
          hierarchical: 'stacked' as const,
          filterSpeckle: 6,
          colorPrecision: 6,
          layerDifference: 16,
          cornerThreshold: 70,
          lengthThreshold: 4.0,
          maxIterations: 10,
          spliceThreshold: 45,
          pathPrecision: 3,
        };
      }

      const svgResult = await convertToSvg(
        imageToConvert,
        itemOutputDir,
        data.baseName,
        conversionOptions
      );

      if (!svgResult) {
        throw new Error('SVG conversion failed');
      }

      await job.updateProgress(50);
      await updateItemStatus(data.batchItemId, 'GENERATING_FILES', 50, 'Generating output files...');

      // ====================================================================
      // Step 3: Generate Additional Files
      // ====================================================================

      // Generate SKU file
      const { sku } = await generateSkuFile(
        itemOutputDir,
        data.baseName,
        1 // Sequence number
      );

      // Generate metadata (listing-info.txt)
      await generateMetadataFile(itemOutputDir, {
        originalFilename: data.originalFilename,
        baseName: data.baseName,
        sku,
        conversionDate: new Date().toISOString(),
        originalWidth: upscaleResult.originalWidth,
        originalHeight: upscaleResult.originalHeight,
        upscaledWidth: upscaleResult.upscaledWidth,
        upscaledHeight: upscaleResult.upscaledHeight,
        upscaleFactor: data.upscaleFactor,
        upscaleApplied: upscaleResult.applied,
        formats: ['svg'],
        substitutionData: data.substitutionData || {},
        marketplacePreview: marketplacePreviewPath ? true : false,
        cncMode: data.cncMode,
      });

      // Apply base assets (copy fallback files if configured)
      if (data.useBaseAssets) {
        await applyBaseAssets(itemOutputDir, data.baseAssetsPath);
      }

      await job.updateProgress(75);
      await updateItemStatus(data.batchItemId, 'ZIPPING', 75, 'Creating ZIP bundle...');

      // ====================================================================
      // Step 4: Create ZIP
      // ====================================================================
      const zipPath = getZipPath(itemOutputDir);
      await createZipFromFolder(itemOutputDir, zipPath);

      await job.updateProgress(90);

      // ====================================================================
      // Step 5: Update Database Records
      // ====================================================================
      const processingTime = Date.now() - startTime;

      await prisma.batchItem.update({
        where: { id: data.batchItemId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          currentStep: null,
          sku,
          svgPath: svgResult.path,
          outputFolderPath: itemOutputDir,
          zipPath,
          upscaledWidth: upscaleResult.upscaledWidth,
          upscaledHeight: upscaleResult.upscaledHeight,
          completedAt: new Date(),
        },
      });

      await upsertGeneratedAssetsForBatchItem(data.batchItemId, [
        { role: 'primary-svg', filePath: svgResult.path, mimeType: 'image/svg+xml' },
        { role: 'preview', filePath: marketplacePreviewPath, mimeType: 'image/jpeg' },
        { role: 'customer-zip', filePath: zipPath, mimeType: 'application/zip' },
      ].filter((asset) => Boolean(asset.filePath)));

      // Append to processing log (includes VTracer settings used)
      await appendToProcessingLog(path.dirname(itemOutputDir), {
        originalFilename: data.originalFilename,
        baseName: data.baseName,
        sku,
        upscaleApplied: upscaleResult.applied,
        upscaleFactor: data.upscaleFactor,
        conversionSteps: [
          `Upscale: ${upscaleResult.applied ? `${data.upscaleFactor}x applied` : 'skipped (above threshold)'}`,
          `Marketplace Preview: ${marketplacePreviewPath ? 'generated' : 'skipped'}`,
          `CNC Mode: ${data.cncMode ? 'enabled (monochrome)' : 'disabled (full color)'}`,
          `VTracer: SVG generated (${svgResult.size} bytes)`,
          `VTracer Settings: ${vtracerSettings ? JSON.stringify(vtracerSettings) : 'default (balanced)'}`,
          `SVGO: Optimized with "${vtracerSettings?.preset || 'balanced'}" preset`,
          `ZIP: Bundle created`,
        ],
        warnings: [],
        errors: [],
        status: 'COMPLETED',
        processingTimeMs: processingTime,
      });

      // Update batch progress
      await updateBatchProgress(data.batchId);

      await job.updateProgress(100);

      logger.info(`Worker: Item ${data.batchItemId} completed in ${processingTime}ms`, {
        sku,
        svgSize: svgResult.size,
        upscaled: upscaleResult.applied,
      });

      await completeCoreExecution({
        executionId: coreExecutionId,
        status: 'SUCCESS',
        resultType: 'vectorforge.processing.completed',
        subjectIds: [data.batchId, data.batchItemId],
        result: { processingTimeMs: processingTime, svgPath: svgResult.path, zipPath },
      });

      return { success: true, sku, processingTime };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      logger.error(`Worker: Item ${data.batchItemId} failed`, {
        error: errorMsg,
        processingTime,
      });

      // Update item as failed
      await prisma.batchItem.update({
        where: { id: data.batchItemId },
        data: {
          status: 'FAILED',
          progress: 0,
          currentStep: null,
          errorMsg,
        },
      });

      // Update batch progress (increment failed count)
      await updateBatchProgress(data.batchId);

      // Append failure to processing log
      await appendToProcessingLog(data.outputBasePath, {
        originalFilename: data.originalFilename,
        baseName: data.baseName,
        sku: 'N/A',
        upscaleApplied: false,
        upscaleFactor: data.upscaleFactor,
        conversionSteps: [],
        warnings: [],
        errors: [errorMsg],
        status: 'FAILED',
        processingTimeMs: processingTime,
      });

      if (coreExecutionId) {
        await completeCoreExecution({
          executionId: coreExecutionId,
          status: 'FAILED',
          resultType: 'vectorforge.processing.failed',
          subjectIds: [data.batchId, data.batchItemId],
          error: { message: errorMsg, processingTimeMs: processingTime },
        }).catch((coreError) => logger.error('Worker: unable to record Core execution failure', { coreError }));
      }

      throw error; // Re-throw for BullMQ retry logic
    }
  },
  {
    connection: redisConnection,
    concurrency: 3, // Process up to 3 items simultaneously
    limiter: {
      max: 10,
      duration: 60000, // Max 10 jobs per minute
    },
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

async function updateItemStatus(
  itemId: string,
  status: string,
  progress: number,
  currentStep: string
) {
  await prisma.batchItem.update({
    where: { id: itemId },
    data: { status: status as never, progress, currentStep },
  });
}

async function updateBatchProgress(batchId: string) {
  const items = await prisma.batchItem.findMany({
    where: { batchId },
    select: { status: true },
  });

  const completed = items.filter((i) => i.status === 'COMPLETED').length;
  const failed = items.filter((i) => i.status === 'FAILED').length;
  const needsManualEdit = items.filter((i) => i.status === 'NEEDS_MANUAL_EDIT').length;
  const total = items.length;

  const allDone = completed + failed + needsManualEdit === total;

  await prisma.batch.update({
    where: { id: batchId },
    data: {
      completedItems: completed,
      failedItems: failed,
      status: allDone
        ? needsManualEdit > 0
          ? 'NEEDS_MANUAL_EDIT' as never
          : failed === total
          ? 'FAILED'
          : 'COMPLETED'
        : 'PROCESSING',
      completedAt: allDone ? new Date() : null,
    },
  });

  // If all items are done, finalize the processing log
  if (allDone) {
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (batch) {
      await finalizeProcessingLog(batch.outputPath || '.', {
        totalItems: total,
        completed,
        failed,
        totalTimeMs: batch.startedAt
          ? Date.now() - new Date(batch.startedAt).getTime()
          : 0,
      });
    }

    logger.info(`Worker: Batch ${batchId} completed`, { completed, failed, total });
  }
}

async function createOutputDirectory(
  basePath: string,
  baseName: string,
  existingPath?: string | null
): Promise<string> {
  if (existingPath) {
    await mkdir(existingPath, { recursive: true });
    return existingPath;
  }

  const folderName = await getIncrementalFolderName(basePath, baseName);
  const outputDir = path.join(basePath, folderName);
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

// ============================================================================
// Worker Event Handlers
// ============================================================================

processingWorker.on('completed', (job) => {
  logger.info(`Worker: Job ${job.id} completed successfully`);
});

processingWorker.on('failed', (job, err) => {
  logger.error(`Worker: Job ${job?.id} failed`, serializeError(err));
});

processingWorker.on('error', (err) => {
  logger.error('Worker: Error', serializeError(err));
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Worker: SIGTERM received, shutting down gracefully...');
  await processingWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Worker: SIGINT received, shutting down gracefully...');
  await processingWorker.close();
  process.exit(0);
});

logger.info('Worker: Processing worker started, waiting for jobs...', { redis: 'connected' });

