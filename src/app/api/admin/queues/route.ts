/**
 * VectorForge - Queue Status API Route
 * Provides queue monitoring data for BullMQ job queues.
 * Protected by Clerk authentication.
 * Access at: /api/admin/queues
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { processingQueue, zipQueue } from '@/lib/queue';

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [processingCounts, zipCounts] = await Promise.all([
      processingQueue.getJobCounts(),
      zipQueue.getJobCounts(),
    ]);

    const [processingJobs, zipJobs] = await Promise.all([
      processingQueue.getJobs(['active', 'waiting', 'completed', 'failed'], 0, 20),
      zipQueue.getJobs(['active', 'waiting', 'completed', 'failed'], 0, 20),
    ]);

    return NextResponse.json({
      queues: [
        {
          name: 'processing',
          counts: processingCounts,
          jobs: processingJobs.map((job) => ({
            id: job.id,
            name: job.name,
            data: job.data,
            progress: job.progress,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            finishedOn: job.finishedOn,
            failedReason: job.failedReason,
          })),
        },
        {
          name: 'zip',
          counts: zipCounts,
          jobs: zipJobs.map((job) => ({
            id: job.id,
            name: job.name,
            data: job.data,
            progress: job.progress,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            finishedOn: job.finishedOn,
            failedReason: job.failedReason,
          })),
        },
      ],
    });
  } catch (error) {
    console.error('Queue status error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queue status' },
      { status: 500 }
    );
  }
}