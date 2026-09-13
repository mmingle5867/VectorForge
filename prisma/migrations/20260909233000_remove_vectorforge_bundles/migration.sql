-- VectorForge no longer owns bundle collections or packaging.  Preserve the
-- generic Core Relationship record, but remove bundle-specific terminology.
ALTER TABLE "relationships" RENAME COLUMN "bundleName" TO "relationshipName";

-- The existing asset_bundle rows were VectorForge test/application records.
-- ListingForge will create its own relationship records when it is introduced.
DELETE FROM "relationships" WHERE "relationshipType" = 'asset_bundle';
