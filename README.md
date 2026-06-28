# VectorForge - Vector File Automation Tool

A local-first tool for bulk-uploading raster images, converting them to professional vector assets (SVG, AI, DXF, EPS + previews), and generating SEF-aligned export packages for downstream tools.

## Tech Stack

- **Framework:** Next.js 15 (App Router) + TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **Authentication:** Local auth mode by default for desktop use; Clerk optional
- **Database:** Local PostgreSQL + Prisma ORM; managed PostgreSQL optional
- **Background Jobs:** BullMQ + Redis (ioredis)
- **Image Processing:** Sharp.js (upscaling) + VTracer (raster-to-vector)
- **ZIP Generation:** JSZip
- **Logging:** Winston (application-level + per-batch processing logs)
- **Validation:** Zod
- **Progress Tracking:** Server-Sent Events (SSE)

## Prerequisites

- Node.js 18+ (recommended: 20+)
- npm or pnpm
- A local PostgreSQL database, or another PostgreSQL database available through `DATABASE_URL`
- Clerk account only if cloud auth is enabled
- Redis server (for BullMQ background jobs)
- VTracer binary or npm package (for vector conversion)

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd vectorforge
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env.local
```

Edit `.env.local` with your actual values:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Local or managed PostgreSQL connection string |
| `LOCAL_AUTH_ENABLED` | Set `true` for local desktop use without Clerk |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Optional, from Clerk dashboard |
| `CLERK_SECRET_KEY` | Optional, from Clerk dashboard |
| `CLERK_WEBHOOK_SECRET` | Optional webhook secret for user sync |
| `REDIS_URL` | Redis connection (default: `redis://localhost:6379`) |
| `UPLOAD_DIR` | Relative or absolute local upload path (default: `./uploads`) |
| `OUTPUT_DIR` | Relative or absolute local output path (default: `./output`) |
| `BASE_ASSETS_DIR` | Relative or absolute local base assets path (default: `./base-assets`) |
| `LOGS_DIR` | Relative or absolute local logs path (default: `./logs`) |

### 3. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database (development)
npx prisma db push

# Or create a migration (production)
npx prisma migrate dev --name init
```

### 4. Redis Setup

```bash
# Install Redis locally (macOS)
brew install redis
brew services start redis

# Or use Docker
docker run -d -p 6379:6379 redis:alpine

# Or use a managed service (Upstash, Redis Cloud, etc.)
```

### 5. Create Required Directories

```bash
mkdir -p uploads output base-assets logs
```

### 6. Run Development Server

```bash
# Start the Next.js dev server
npm run dev

# In a separate terminal, start the background worker
npm run worker:dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

On Windows, you can also use the desktop launcher:

- [docs/LOCAL_STARTUP.md](docs/LOCAL_STARTUP.md)
- `Start VectorForge.bat`

Local-first and SEMA identity rules are documented in [docs/SEMA_FOUNDATION.md](docs/SEMA_FOUNDATION.md).

## Background Jobs (BullMQ + Redis)

VectorForge uses **BullMQ** with **Redis** for reliable background job processing:

### Architecture
- **Processing Queue** (`vectorforge:processing`): Handles individual item processing (upscale → convert → generate files)
- **ZIP Queue** (`vectorforge:zip`): Creates ZIP bundles after all items in a batch complete

### Features
- Automatic retries (3 attempts with exponential backoff)
- Job prioritization
- Progress reporting via Redis pub/sub → SSE
- Graceful failure handling per item (batch continues if one item fails)

### Worker Process
The worker runs as a separate process alongside the Next.js server:

```bash
# Production
npm run worker

# Development (with hot reload)
npm run worker:dev
```

### Queue Monitoring
Use BullMQ's built-in dashboard or connect to Redis to monitor:
```bash
redis-cli
> KEYS vectorforge:*
```

## Project Structure

```
vectorforge/
├── prisma/
│   └── schema.prisma              # Database schema (User, Batch, BatchItem, UserSettings)
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── sign-in/           # Clerk sign-in page
│   │   │   └── sign-up/           # Clerk sign-up page
│   │   ├── (dashboard)/
│   │   │   ├── dashboard/         # Main dashboard (batch history, progress)
│   │   │   ├── upload/            # Upload + pre-conversion review
│   │   │   ├── settings/          # Global settings page
│   │   │   └── batch/[id]/        # Individual batch detail view
│   │   ├── api/
│   │   │   ├── batches/           # Batch CRUD endpoints
│   │   │   ├── convert/           # Conversion pipeline trigger
│   │   │   ├── download/          # File/ZIP download endpoints
│   │   │   ├── settings/          # User settings endpoints
│   │   │   ├── sse/               # Server-Sent Events for progress
│   │   │   ├── upload/            # File upload endpoint
│   │   │   └── webhooks/          # Clerk webhook for user sync
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx               # Landing page
│   ├── components/
│   │   ├── ui/                    # shadcn/ui components
│   │   ├── dashboard/             # Dashboard-specific components
│   │   ├── upload/                # Upload & review components
│   │   └── shared/                # Shared/layout components
│   ├── lib/
│   │   ├── config.ts              # App configuration (relative or absolute local paths)
│   │   ├── logger.ts              # Winston logger setup
│   │   ├── prisma.ts              # Prisma client singleton
│   │   ├── queue.ts               # BullMQ queue setup + Redis connection
│   │   ├── types.ts               # TypeScript interfaces & type definitions
│   │   ├── utils.ts               # Utility functions (SKU, naming, etc.)
│   │   └── validations.ts         # Zod validation schemas
│   ├── services/
│   │   ├── base-assets.ts         # Base assets fallback logic
│   │   ├── conversion.ts          # VTracer conversion service
│   │   ├── metadata.ts            # listing-info.txt generation
│   │   ├── processing-log.ts      # Per-batch processing-log.txt
│   │   ├── sku-generator.ts       # SKU generation + blank .txt file
│   │   ├── upscaler.ts            # Sharp.js upscaling service
│   │   └── zip-generator.ts       # JSZip bundle creation
│   └── workers/
│       └── processing-worker.ts   # BullMQ worker process
├── uploads/                       # Uploaded files (gitignored)
├── output/                        # Generated output (gitignored)
├── base-assets/                   # Base asset templates
├── logs/                          # Application logs (gitignored)
├── .env.example
├── .gitignore
├── next.config.js
├── package.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

## Key Features

### Pre-Conversion Review
After uploading, review each image individually. Set or edit base names, choose upscale factors per file.

### Smart Upscaling
Images below the threshold (default: 2000px width/height) are automatically upscaled using Sharp.js before conversion. Configurable globally in settings and per-batch.

### Vector Conversion (VTracer)
VTracer is the primary and preferred raster-to-vector engine:
- Produces clean, optimized SVG output
- Best quality/speed balance for listing-ready vectors
- Configurable parameters (color mode, speckle filter, precision, etc.)
- Additional formats (AI, DXF, EPS) generated from SVG

### Output Structure & Naming
For each processed item:
- **Unzipped folder** with all files (original, upscaled, SVG, AI, DXF, EPS, SKU file, metadata, processing log)
- **Identical ZIP file** of that exact folder
- Both available for download

**Incremental naming convention:**
- First item: `basename/` and `basename.zip`
- Duplicates: `basename_001/`, `basename_002/`, etc.
- SKU format: `DIGI-001-[basename]-[sequencenumber]`

### Base Assets Fallback
The `./base-assets/` directory contains template files:
- For each batch item, VectorForge checks if expected files exist in the output
- Missing files are automatically copied from base-assets
- Batch-specific files always take priority over fallbacks

### Real-Time Progress Tracking (SSE)
Server-Sent Events provide live updates during processing:
- Per-item status: `Pending → Upscaling → Converting → Generating Files → Zipping → Completed/Failed`
- Batch percentage complete
- Current item being processed
- Estimated time remaining

### Logging
- **Application log** (`./logs/vectorforge.log`): Server-side errors, events, queue status
- **Per-batch log** (`processing-log.txt`): Detailed record of each item's processing (timestamp, filename, SKU, upscale info, conversion steps, warnings, status)

### Listing Preview Image

Automatically generates a composite preview image for each converted vector, ready for listing images.

**What it does:**
- Composites the converted SVG (rendered as PNG) onto a configurable background image
- Applies a semi-transparent watermark overlay
- Optionally applies a color tint to the preview
- Outputs a `preview.jpg` alongside the vector files in each item's output folder

**How to configure:**
1. Go to **Settings** in the dashboard
2. Enable the **"Listing Preview"** toggle
3. Optionally configure the color tint (hex color + opacity)

**Required base assets in `./base-assets/`:**

| File | Description |
|------|-------------|
| `preview-background.jpg` | Background image for the preview composite (recommended: 2000×2000px) |
| `watermark.png` | Transparent PNG watermark overlay |

If these files are missing when Listing Preview is enabled, the step will be skipped with a warning in the processing log.

### CNC / Vinyl / Laser Cutter Mode

Switches VTracer to binary/monochrome tracing optimized for cutting machines (CNC routers, vinyl cutters, laser engravers).

**What it does:**
- Forces VTracer into binary color mode (single-color output)
- Produces clean, closed paths suitable for machine cutting
- Removes color complexity and gradients that confuse cutting software
- Output SVGs contain only solid black paths on a transparent background

**How to enable:**
1. Go to **Settings** in the dashboard
2. Toggle **"CNC/Vinyl/Laser Cutter Mode"** (enabled by default)
3. When enabled, all conversions use binary tracing regardless of the selected VTracer preset

> 💡 **Tip:** This mode is ideal when your vectors will be used with Cricut, Silhouette, or similar cutting machines. Disable it if you need full-color vector output for print or digital use.

---

### Testing the Listing Preview

To test the Listing Preview feature end-to-end:

1. **Place a background image** — Save a `preview-background.jpg` (recommended 2000×2000px, JPEG) in the `./base-assets/` directory
2. **Place a watermark** — Save a `watermark.png` (transparent PNG, e.g. your logo or "SAMPLE" text) in `./base-assets/`
3. **Enable the feature** — Go to Settings → toggle "Listing Preview" on
4. **Upload and convert** — Upload any raster image and start conversion
5. **Check output** — In the output folder for the processed item, you'll find a `preview.jpg` composited with your background and watermark

---

## Configuration

**Paths are configurable via `.env.local` and may be relative project paths or absolute local filesystem paths:**

| Variable | Default | Description |
|----------|---------|-------------|
| `UPLOAD_DIR` | `./uploads` | Where uploaded files are stored |
| `OUTPUT_DIR` | `./output` | Where processed output goes |
| `BASE_ASSETS_DIR` | `./base-assets` | Fallback assets directory |
| `LOGS_DIR` | `./logs` | Application log files |
| `DATABASE_URL` | local PostgreSQL URL | Database connection |
| `LOCAL_AUTH_ENABLED` | `true` for launcher use | Bypass Clerk for local desktop use |
| `REDIS_URL` | `redis://localhost:6379` | Redis for BullMQ |
| `DEFAULT_UPSCALE_FACTOR` | `2` | Default upscale multiplier (1, 2, or 4) |
| `SMART_UPSCALE_THRESHOLD` | `2000` | Upscale if below this px |
| `MAX_BATCH_SIZE` | `50` | Maximum files per batch |

> Important: use local filesystem paths for normal VectorForge operation. Avoid cloud-synced working directories for uploads, output, assets, and logs.

## Deployment

### Vercel (Recommended for Web App)

1. Push to GitHub
2. Import in Vercel
3. Set environment variables
4. Deploy

**Note:** The background worker must run separately (e.g., on a VPS, Railway, or Render). Vercel serverless functions have execution time limits.

### Self-Hosted (Full Stack)

```bash
# Build
npm run build

# Start web server
npm start

# Start worker (separate process/terminal)
npm run worker
```

### Docker (Recommended for Production)

```dockerfile
# docker-compose.yml includes:
# - Next.js web app
# - BullMQ worker
# - Redis
```

Ensure the server has write access to `uploads/`, `output/`, `base-assets/`, and `logs/` directories.

## License

MIT
