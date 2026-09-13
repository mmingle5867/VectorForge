'use client';

import DashboardFileExplorer from '@/components/dashboard-file-explorer';

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Browse, organize, and process your artwork working copies.
        </p>
      </div>
      <DashboardFileExplorer />
    </div>
  );
}
