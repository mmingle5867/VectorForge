# VectorForge Project Audit

Date: 2026-06-07

This audit was created from a read-only review of the repository. No application code was modified.

## Project Structure

This is a Next.js app organized under `src/`:

- `src/app/`: Next App Router pages and API routes.
  - `(auth)/`: Clerk sign-in/sign-up pages.
  - `(dashboard)/`: dashboard, upload, review, processing, output, and settings pages.
  - `api/`: upload, convert, batches, settings, preview, Clerk webhook, and queue/admin endpoints.
- `src/lib/`: shared server/client utilities, including auth, Prisma, queue, config, validation, types, and VTracer presets.
- `src/services/`: image/vector processing services, including upscaling, conversion, metadata, ZIP generation, preview generation, and base assets.
- `src/workers/`: BullMQ background worker.
- `prisma/schema.prisma`: database schema.
- `docs/`: VTracer optimization notes.
- Runtime folders expected by the app: `uploads/`, `output/`, `base-assets/`, and `logs/`.

## Framework, Backend, Database, And Auth

- Framework: Next.js 15 App Router with TypeScript and React 18.
- Styling: Tailwind CSS. The README claims shadcn/ui, but there is no `src/components/ui/` implementation in the actual tree.
- Backend: Next.js API routes plus a separate BullMQ worker.
- Database: PostgreSQL via Prisma, intended for Neon Postgres.
- Auth: Clerk via `@clerk/nextjs`, protected by `src/middleware.ts`.
- User sync: local `User` records are synced through `src/app/api/webhooks/clerk/route.ts`, with fallback lazy creation in `src/lib/auth.ts`.
- Queue: BullMQ + Redis via `src/lib/queue.ts`.
- Processing: Sharp, `wasm_vtracer`, SVGO, and JSZip.

## Commands

From `package.json`:

- Install: `npm install`
- Dev web app: `npm run dev`
- Build: `npm run build`
- Production web server after build: `npm start`
- Lint: `npm run lint`
- Prisma generate: automatic via `postinstall`, or `npx prisma generate`
- DB push: `npm run db:push`
- DB migration: `npm run db:migrate`
- Prisma Studio: `npm run db:studio`
- Seed: `npm run db:seed`
- Worker: `npm run worker`
- Worker dev: `npm run worker:dev`

Important setup note: `node_modules` was absent during the audit, so local scripts will not work until `npm install` runs. A no-output TypeScript check could not run because dependencies were not installed; `npx` attempted to fetch the unrelated `tsc@2.0.4` package instead of using the local TypeScript compiler.

## Likely Problems, Missing Pieces, And Incomplete Features

1. Main conversion flow does not send users to the processing page.
   `src/app/(dashboard)/upload/review/[batchId]/page.tsx` routes to `/dashboard` after starting conversion, while `/processing/[batchId]` exists.

2. Per-batch substitutions UI is disconnected.
   The review page imports and stores `substitutions`, but `saveChanges()` only sends item fields and never sends `rowsToObject(substitutions)` to the backend.

3. No API exists to update batch-level `substitutionData`, VTracer settings, batch name, or batch config from the review page.
   The worker expects `data.substitutionData.__vtracerSettings`, but the current UI/API path does not appear to persist it.

4. Worker only generates SVG, not AI/DXF/EPS, despite README claims.
   Conversion helpers exist in `src/services/conversion.ts`, but the worker never calls `convertToAi`, `convertToDxf`, or `convertToEps`.

5. SKU sequence is hardcoded to `1`.
   `src/workers/processing-worker.ts` calls `generateSkuFile(..., 1)`, ignoring the item's actual `sequenceNumber`.

6. Cancellation does not cancel queued/running BullMQ jobs.
   `src/app/api/batches/[batchId]/cancel/route.ts` says it removes pending jobs, but the implementation only updates database rows.

7. Batch output/log paths are incomplete.
   Upload creates a batch without `outputPath`, and the worker finalizes logs using `batch.outputPath || '.'`, so logs may land in the wrong place.

8. Settings storage is overloaded.
   Extended settings are stored inside `defaultSubstitutions`, mixed with user template variables. The comment says reserved keys are prefixed with `__`, but the actual keys are not.

9. README overstates implemented architecture.
   It references Redis pub/sub SSE, ZIP queue, shadcn/ui, Docker compose, and AI/DXF/EPS output, but the implementation uses DB polling SSE, no visible ZIP worker usage, no `components/ui`, no Docker files, and SVG-only worker output.

10. Text encoding is visibly corrupted in many UI strings and README sections.
    Examples include `â†`, `ðŸ“`, `â€¢`, and similar mojibake in JSX and docs.

## Prioritized Fix List

1. Run `npm install`, then verify with `npm run build` or `npm exec tsc -- --noEmit --incremental false`.
2. Fix the core upload-to-processing flow so it routes to `/processing/${batchId}` after conversion starts.
3. Add or update API support for batch-level review data: substitutions, VTracer settings, batch name, and output settings.
4. Wire review page substitutions and VTracer settings into persisted `Batch.substitutionData`.
5. Make cancellation actually remove queued BullMQ jobs and make the worker honor cancelled batches before and during processing.
6. Generate all promised output formats or update the README/UI to say SVG-only until AI/DXF/EPS are real.
7. Fix SKU sequence handling by passing and storing each item's actual `sequenceNumber`.
8. Normalize settings schema instead of hiding app options inside `defaultSubstitutions`.
9. Correct output/log path handling and ensure required directories are created before processing.
10. Clean encoding/mojibake across README and UI strings.
