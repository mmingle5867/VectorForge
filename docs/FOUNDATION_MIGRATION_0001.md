# Foundation Migration 0001

This migration is the first additive change after the existing VectorForge database was registered as `0_init`.

## Scope

The migration adds:

- local SEMA profiles;
- registered storage locations;
- immutable Asset versions and relative Asset locations;
- hierarchical Categories;
- Item and Bundle/Relationship Category memberships;
- persistent dashboard and Category-tree preferences.

Existing Batch, upload, processing, Preview/Tune, Bundle, `Asset.filePath`, and output behavior is not redirected by this migration.

## Safe Local Procedure

1. Confirm `git status --short --branch` is clean before applying the patch.
2. Apply the supplied patch and run `npx prisma format`.
3. Run `npx prisma validate`.
4. Generate but do not apply the migration:

   `npx prisma migrate dev --name add_profile_storage_versions_categories --create-only`

5. Inspect the generated `migration.sql`. It should create new enums, tables, indexes, and foreign keys. It should not drop or rename existing tables, columns, indexes, or enums.
6. Apply the reviewed migration with `npx prisma migrate dev`.
7. Run `npx prisma generate` if it was not completed automatically.
8. Run `npm run test:foundation-rules`.
9. Run the existing project validation and build commands.

## Rollout Boundary

Do not backfill Asset versions or point intake at registered Storage Locations in this migration. Those operations require separate copy, hash, verification, retry, and rollback logic.

Organization and Project Category scopes are reserved but intentionally rejected by the Category service until their membership and permission foundations exist.
