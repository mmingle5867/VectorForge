-- CreateEnum
CREATE TYPE "SemaProfileStatus" AS ENUM ('ACTIVE', 'DISABLED', 'RETIRED');

-- CreateEnum
CREATE TYPE "StorageLocationKind" AS ENUM ('LOCAL_FILESYSTEM', 'NETWORK_FILESYSTEM', 'REMOVABLE_STORAGE', 'CLOUD_PROVIDER', 'OTHER');

-- CreateEnum
CREATE TYPE "StorageLocationStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE', 'READ_ONLY', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetVersionStatus" AS ENUM ('DRAFT', 'PREVIEW', 'APPROVED', 'RETIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AssetLocationStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'MISSING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CategoryScopeType" AS ENUM ('PROFILE', 'WORKSPACE', 'ORGANIZATION', 'PROJECT');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'RETIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "DashboardViewMode" AS ENUM ('LARGE_IMAGE', 'THUMBNAIL', 'LIST', 'DETAILS');

-- CreateEnum
CREATE TYPE "CategoryMatchMode" AS ENUM ('ANY', 'ALL');

-- CreateTable
CREATE TABLE "sema_profiles" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "SemaProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sema_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "StorageLocationKind" NOT NULL,
    "basePath" TEXT NOT NULL,
    "isDefaultImport" BOOLEAN NOT NULL DEFAULT false,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "status" "StorageLocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_versions" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdByProfileId" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "status" "AssetVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "sha256" TEXT NOT NULL,
    "byteLength" BIGINT NOT NULL,
    "mimeType" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_locations" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "storageLocationId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssetLocationStatus" NOT NULL DEFAULT 'AVAILABLE',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "scopeType" "CategoryScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "parentId" TEXT,
    "parentKey" TEXT NOT NULL DEFAULT '__ROOT__',
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assignedByProfileId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_categories" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assignedByProfileId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_preferences" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "contextKey" TEXT NOT NULL,
    "viewMode" "DashboardViewMode" NOT NULL DEFAULT 'THUMBNAIL',
    "expandedCategoryIds" JSONB NOT NULL DEFAULT '[]',
    "selectedCategoryIds" JSONB NOT NULL DEFAULT '[]',
    "includeDescendants" BOOLEAN NOT NULL DEFAULT true,
    "categoryMatchMode" "CategoryMatchMode" NOT NULL DEFAULT 'ANY',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "sorting" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sema_profiles_profileId_key" ON "sema_profiles"("profileId");

-- CreateIndex
CREATE INDEX "sema_profiles_userId_status_idx" ON "sema_profiles"("userId", "status");

-- CreateIndex
CREATE INDEX "sema_profiles_userId_isDefault_idx" ON "sema_profiles"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_locationId_key" ON "storage_locations"("locationId");

-- CreateIndex
CREATE INDEX "storage_locations_workspaceId_idx" ON "storage_locations"("workspaceId");

-- CreateIndex
CREATE INDEX "storage_locations_profileId_isDefaultImport_idx" ON "storage_locations"("profileId", "isDefaultImport");

-- CreateIndex
CREATE INDEX "storage_locations_status_idx" ON "storage_locations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_profileId_name_key" ON "storage_locations"("profileId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_assetVersionId_key" ON "asset_versions"("assetVersionId");

-- CreateIndex
CREATE INDEX "asset_versions_createdByProfileId_idx" ON "asset_versions"("createdByProfileId");

-- CreateIndex
CREATE INDEX "asset_versions_status_idx" ON "asset_versions"("status");

-- CreateIndex
CREATE INDEX "asset_versions_sha256_idx" ON "asset_versions"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_assetId_versionNumber_key" ON "asset_versions"("assetId", "versionNumber");

-- CreateIndex
CREATE INDEX "asset_locations_assetVersionId_status_idx" ON "asset_locations"("assetVersionId", "status");

-- CreateIndex
CREATE INDEX "asset_locations_storageLocationId_status_idx" ON "asset_locations"("storageLocationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "asset_locations_storageLocationId_relativePath_key" ON "asset_locations"("storageLocationId", "relativePath");

-- CreateIndex
CREATE UNIQUE INDEX "asset_locations_assetVersionId_storageLocationId_relativePa_key" ON "asset_locations"("assetVersionId", "storageLocationId", "relativePath");

-- CreateIndex
CREATE UNIQUE INDEX "categories_categoryId_key" ON "categories"("categoryId");

-- CreateIndex
CREATE INDEX "categories_profileId_scopeType_scopeId_idx" ON "categories"("profileId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "categories_parentId_sortOrder_idx" ON "categories"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "categories_status_idx" ON "categories"("status");

-- CreateIndex
CREATE UNIQUE INDEX "categories_profileId_scopeType_scopeId_parentKey_normalized_key" ON "categories"("profileId", "scopeType", "scopeId", "parentKey", "normalizedName");

-- CreateIndex
CREATE INDEX "item_categories_categoryId_idx" ON "item_categories"("categoryId");

-- CreateIndex
CREATE INDEX "item_categories_itemId_isPrimary_idx" ON "item_categories"("itemId", "isPrimary");

-- CreateIndex
CREATE INDEX "item_categories_assignedByProfileId_idx" ON "item_categories"("assignedByProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_itemId_categoryId_key" ON "item_categories"("itemId", "categoryId");

-- CreateIndex
CREATE INDEX "relationship_categories_categoryId_idx" ON "relationship_categories"("categoryId");

-- CreateIndex
CREATE INDEX "relationship_categories_relationshipId_isPrimary_idx" ON "relationship_categories"("relationshipId", "isPrimary");

-- CreateIndex
CREATE INDEX "relationship_categories_assignedByProfileId_idx" ON "relationship_categories"("assignedByProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_categories_relationshipId_categoryId_key" ON "relationship_categories"("relationshipId", "categoryId");

-- CreateIndex
CREATE INDEX "dashboard_preferences_workspaceId_idx" ON "dashboard_preferences"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_preferences_profileId_contextKey_key" ON "dashboard_preferences"("profileId", "contextKey");

-- AddForeignKey
ALTER TABLE "sema_profiles" ADD CONSTRAINT "sema_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "sema_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_createdByProfileId_fkey" FOREIGN KEY ("createdByProfileId") REFERENCES "sema_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_locations" ADD CONSTRAINT "asset_locations_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_locations" ADD CONSTRAINT "asset_locations_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "sema_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_assignedByProfileId_fkey" FOREIGN KEY ("assignedByProfileId") REFERENCES "sema_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_categories" ADD CONSTRAINT "relationship_categories_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "relationships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_categories" ADD CONSTRAINT "relationship_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_categories" ADD CONSTRAINT "relationship_categories_assignedByProfileId_fkey" FOREIGN KEY ("assignedByProfileId") REFERENCES "sema_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_preferences" ADD CONSTRAINT "dashboard_preferences_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "sema_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_preferences" ADD CONSTRAINT "dashboard_preferences_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
