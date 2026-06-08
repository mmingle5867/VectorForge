/**
 * VectorForge - SSE Progress Tracking Endpoint
 * Streams real-time batch processing progress to the client.
 *
 * Usage: EventSource('/api/batches/{batchId}/progress')
 *
 * Events emitted:
 * - progress: { batchId, status, completedItems, failedItems, totalItems, items: [...] }
 * - complete: { batchId, status, completedItems, failedItems, totalItems }
 * - error: { message }
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId } = await params;

    // Verify batch ownership
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.userId !== user.id) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    let intervalId: NodeJS.Timeout | null = null;
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection event
        controller.enqueue(
          encoder.encode(`event: connected\ndata: ${JSON.stringify({ batchId })}\n\n`)
        );

        // Poll database every 1.5 seconds for progress updates
        intervalId = setInterval(async () => {
          if (closed) {
            if (intervalId) clearInterval(intervalId);
            return;
          }

          try {
            const currentBatch = await prisma.batch.findUnique({
              where: { id: batchId },
              include: {
                items: {
                  select: {
                    id: true,
                    originalFilename: true,
                    baseName: true,
                    status: true,
                    progress: true,
                    currentStep: true,
                    sku: true,
                    errorMsg: true,
                  },
                  orderBy: { sequenceNumber: 'asc' },
                },
              },
            });

            if (!currentBatch) {
              controller.enqueue(
                encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'Batch not found' })}\n\n`)
              );
              closed = true;
              if (intervalId) clearInterval(intervalId);
              controller.close();
              return;
            }

            const progressData = {
              batchId: currentBatch.id,
              status: currentBatch.status,
              completedItems: currentBatch.completedItems,
              failedItems: currentBatch.failedItems,
              totalItems: currentBatch.totalItems,
              items: currentBatch.items,
            };

            controller.enqueue(
              encoder.encode(`event: progress\ndata: ${JSON.stringify(progressData)}\n\n`)
            );

            // If batch is complete, send final event and close
            if (
              currentBatch.status === 'COMPLETED' ||
              currentBatch.status === 'FAILED'
            ) {
              controller.enqueue(
                encoder.encode(`event: complete\ndata: ${JSON.stringify({
                  batchId: currentBatch.id,
                  status: currentBatch.status,
                  completedItems: currentBatch.completedItems,
                  failedItems: currentBatch.failedItems,
                  totalItems: currentBatch.totalItems,
                })}\n\n`)
              );
              closed = true;
              if (intervalId) clearInterval(intervalId);
              controller.close();
            }
          } catch (err) {
            // If we can't read from DB, send error but don't close immediately
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'Failed to fetch progress' })}\n\n`)
            );
          }
        }, 1500);
      },
      cancel() {
        closed = true;
        if (intervalId) clearInterval(intervalId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}