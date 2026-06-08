import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const { userId } = await auth();

  // If already signed in, redirect to dashboard
  if (userId) {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <svg
              className="h-8 w-8 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="text-xl font-bold text-gray-900">VectorForge</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="max-w-3xl">
          <h1 className="text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
            Bulk Vector Conversion
            <span className="block text-blue-600">Made Simple</span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            Upload raster images, automatically convert to professional vector bundles
            (SVG, AI, DXF, EPS), and generate marketplace-ready ZIP packages for
            Etsy, eBay, and more.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
            >
              Start Converting
            </Link>
            <Link
              href="/sign-in"
              className="rounded-lg border border-gray-300 px-6 py-3 text-base font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Sign In
            </Link>
          </div>

          {/* Features Grid */}
          <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-6">
              <div className="mb-3 text-3xl">⚡</div>
              <h3 className="font-semibold text-gray-900">Bulk Processing</h3>
              <p className="mt-2 text-sm text-gray-600">
                Upload up to 50 images at once. Smart upscaling + VTracer conversion.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-6">
              <div className="mb-3 text-3xl">📦</div>
              <h3 className="font-semibold text-gray-900">Marketplace Ready</h3>
              <p className="mt-2 text-sm text-gray-600">
                Auto-generated ZIP bundles with metadata, SKUs, and all formats included.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-6">
              <div className="mb-3 text-3xl">🎯</div>
              <h3 className="font-semibold text-gray-900">Multiple Formats</h3>
              <p className="mt-2 text-sm text-gray-600">
                SVG, AI, DXF, EPS + preview thumbnails. All in one click.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t bg-gray-50 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} VectorForge. All rights reserved.
        </div>
      </footer>
    </div>
  );
}