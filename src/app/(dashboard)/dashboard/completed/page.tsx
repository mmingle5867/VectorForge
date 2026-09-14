'use client';

import Link from 'next/link';

import DashboardFileExplorer from '@/components/dashboard-file-explorer';

export default function CompletedVectorArtworkPage() {
  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard" className="rounded-md border px-3 py-1.5 text-sm font-semibold">Artwork Workspace</Link>
          <span className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">Completed Vector Artwork</span>
        </div>
        <h1 className="mt-5 text-2xl font-bold text-gray-900 dark:text-white">Completed Vector Artwork</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Approved artwork is ready for ListingForge and other applications through the VectorForge readiness capability.</p>
      </div>
      <DashboardFileExplorer scope="ready" />
    </div>
  );
}
