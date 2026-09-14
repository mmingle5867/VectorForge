'use client';

import Link from 'next/link';

import DashboardFileExplorer from '@/components/dashboard-file-explorer';

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">Artwork Workspace</span>
          <Link href="/dashboard/completed" className="rounded-md border px-3 py-1.5 text-sm font-semibold">Completed Vector Artwork</Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Browse, organize, and process your artwork working copies.
        </p>
      </div>
      <DashboardFileExplorer />
    </div>
  );
}
