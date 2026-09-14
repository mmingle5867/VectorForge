# VectorForge SEMA Core Adoption v0.65.0

## Purpose

VectorForge now consumes the published SEMA Core, Foundation, Facilities, and
Capabilities packages. It no longer owns a second implementation of the Base56
KeyID algorithm.

## Identity behavior

- Existing KeyIDs are retained exactly as issued; there is no renumbering.
- Every new VectorForge KeyID is issued through `@selo/sema-core` using the
  existing installation `3`.
- A reservation is keyed by its first requested KeyID. It does not consume an
  extra LocalID; for example, a child Core's first issued object remains
  `child-installation-3`.
- Type codes remain human-readable ledger metadata, never part of a KeyID.
- The Core Host bootstrap backfills the existing issued-ID ledger into one
  historical reservation. It is idempotent.

## Installation order

1. Install the published SEMA Core Host v0.2.1 and shared package v0.1.1
   updates first.
2. Run this VectorForge updater while VectorForge is stopped.
3. The updater installs dependencies, deploys the migration, generates Prisma,
   backfills and verifies the Core Host ledger, then runs validation.

The update changes database schema and Core ledger metadata only. It does not
move, rename, delete, or modify artwork files.

## Follow-up

The next SEMA slice will expose the Core Host, Foundation, Facilities, and
Capabilities through a unified system-console backend and UI. This update is
the application-side adapter that makes that possible.
