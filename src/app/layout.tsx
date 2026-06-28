import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import config from '@/lib/config';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: `${config.identity.displayName} - Vector File Automation Tool`,
  description:
    'Bulk-upload raster images, automatically convert to professional vector bundles (SVG, AI, DXF, EPS), and generate listing-ready ZIP packages.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (config.localFirst.localAuthEnabled) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>{children}</body>
      </html>
    );
  }

  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
