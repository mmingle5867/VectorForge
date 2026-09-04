-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'NEEDS_MANUAL_EDIT', 'READY_TO_PROCESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatchItemStatus" AS ENUM ('PENDING', 'UPSCALING', 'CONVERTING', 'GENERATING_FILES', 'ZIPPING', 'NEEDS_MANUAL_EDIT', 'READY_TO_PROCESS', 'PROCESSING', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IssuedNumberStatus" AS ENUM ('ISSUED', 'ASSIGNED', 'VOIDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ArtworkStatus" AS ENUM ('ACTIVE', 'RETIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AssetProfileType" AS ENUM ('DIGITAL', 'LASER', 'VINYL', 'CNC', 'SEWING', 'PRINT');

-- CreateEnum
CREATE TYPE "AssetProfileStatus" AS ENUM ('ACTIVE', 'RETIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ProductVariantStatus" AS ENUM ('ACTIVE', 'RETIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'RETIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'RETIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('ACTIVE', 'RETIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'RETIRED', 'VOIDED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultUpscaleFactor" INTEGER NOT NULL DEFAULT 2,
    "smartUpscaleThreshold" INTEGER NOT NULL DEFAULT 2000,
    "baseAssetsPath" TEXT NOT NULL DEFAULT './base-assets',
    "outputPath" TEXT NOT NULL DEFAULT './output',
    "defaultSubstitutions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerId" TEXT,
    "workspaceId" TEXT,
    "name" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'PENDING',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "currentItemId" TEXT,
    "upscaleFactor" INTEGER NOT NULL DEFAULT 2,
    "smartUpscaleThreshold" INTEGER NOT NULL DEFAULT 2000,
    "useBaseAssets" BOOLEAN NOT NULL DEFAULT true,
    "substitutionData" JSONB NOT NULL DEFAULT '{}',
    "outputPath" TEXT,
    "zipPath" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ownerId" TEXT,
    "workspaceId" TEXT,
    "itemId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "baseName" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 1,
    "sku" TEXT,
    "artworkId" TEXT,
    "assetProfileId" TEXT,
    "artworkNumber" TEXT,
    "profileNumber" TEXT,
    "status" "BatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "errorMsg" TEXT,
    "originalWidth" INTEGER,
    "originalHeight" INTEGER,
    "originalSize" INTEGER,
    "mimeType" TEXT,
    "upscaleFactor" INTEGER NOT NULL DEFAULT 2,
    "upscaleApplied" BOOLEAN NOT NULL DEFAULT false,
    "upscaledWidth" INTEGER,
    "upscaledHeight" INTEGER,
    "uploadPath" TEXT,
    "upscaledPath" TEXT,
    "svgPath" TEXT,
    "aiPath" TEXT,
    "dxfPath" TEXT,
    "epsPath" TEXT,
    "previewPath" TEXT,
    "outputFolderPath" TEXT,
    "zipPath" TEXT,
    "skuFilePath" TEXT,
    "metadataPath" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" TEXT NOT NULL,
    "sequenceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "paddingLength" INTEGER NOT NULL DEFAULT 6,
    "nextNumber" INTEGER NOT NULL,
    "lastIssuedNumber" INTEGER,
    "startingNumber" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issued_numbers" (
    "id" TEXT NOT NULL,
    "sequenceKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "numericSequence" INTEGER NOT NULL,
    "issuedNumber" TEXT NOT NULL,
    "itemId" TEXT,
    "batchId" TEXT,
    "artworkId" TEXT,
    "assetProfileId" TEXT,
    "status" "IssuedNumberStatus" NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "issued_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artworks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerId" TEXT,
    "workspaceId" TEXT,
    "itemId" TEXT,
    "artworkNumber" TEXT NOT NULL,
    "numericSequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "sourceItemId" TEXT,
    "status" "ArtworkStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_profiles" (
    "id" TEXT NOT NULL,
    "artworkId" TEXT NOT NULL,
    "profileType" "AssetProfileType" NOT NULL,
    "profileNumber" TEXT NOT NULL,
    "numericSequence" INTEGER NOT NULL,
    "status" "AssetProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "assetProfileId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "optionData" JSONB NOT NULL DEFAULT '{}',
    "status" "ProductVariantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "artworkId" TEXT NOT NULL,
    "batchItemId" TEXT,
    "role" TEXT NOT NULL,
    "filePath" TEXT,
    "mimeType" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationships" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "artworkId" TEXT NOT NULL,
    "bundleName" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_members" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationship_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'txt',
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- CreateIndex
CREATE INDEX "batches_userId_idx" ON "batches"("userId");

-- CreateIndex
CREATE INDEX "batches_ownerId_idx" ON "batches"("ownerId");

-- CreateIndex
CREATE INDEX "batches_workspaceId_idx" ON "batches"("workspaceId");

-- CreateIndex
CREATE INDEX "batches_status_idx" ON "batches"("status");

-- CreateIndex
CREATE INDEX "batch_items_batchId_idx" ON "batch_items"("batchId");

-- CreateIndex
CREATE INDEX "batch_items_ownerId_idx" ON "batch_items"("ownerId");

-- CreateIndex
CREATE INDEX "batch_items_workspaceId_idx" ON "batch_items"("workspaceId");

-- CreateIndex
CREATE INDEX "batch_items_itemId_idx" ON "batch_items"("itemId");

-- CreateIndex
CREATE INDEX "batch_items_status_idx" ON "batch_items"("status");

-- CreateIndex
CREATE INDEX "batch_items_artworkId_idx" ON "batch_items"("artworkId");

-- CreateIndex
CREATE INDEX "batch_items_assetProfileId_idx" ON "batch_items"("assetProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_sequenceKey_key" ON "number_sequences"("sequenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "issued_numbers_issuedNumber_key" ON "issued_numbers"("issuedNumber");

-- CreateIndex
CREATE INDEX "issued_numbers_itemId_idx" ON "issued_numbers"("itemId");

-- CreateIndex
CREATE INDEX "issued_numbers_batchId_idx" ON "issued_numbers"("batchId");

-- CreateIndex
CREATE INDEX "issued_numbers_artworkId_idx" ON "issued_numbers"("artworkId");

-- CreateIndex
CREATE INDEX "issued_numbers_assetProfileId_idx" ON "issued_numbers"("assetProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "issued_numbers_sequenceKey_numericSequence_key" ON "issued_numbers"("sequenceKey", "numericSequence");

-- CreateIndex
CREATE UNIQUE INDEX "artworks_artworkNumber_key" ON "artworks"("artworkNumber");

-- CreateIndex
CREATE INDEX "artworks_userId_idx" ON "artworks"("userId");

-- CreateIndex
CREATE INDEX "artworks_ownerId_idx" ON "artworks"("ownerId");

-- CreateIndex
CREATE INDEX "artworks_workspaceId_idx" ON "artworks"("workspaceId");

-- CreateIndex
CREATE INDEX "artworks_itemId_idx" ON "artworks"("itemId");

-- CreateIndex
CREATE INDEX "artworks_status_idx" ON "artworks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "asset_profiles_profileNumber_key" ON "asset_profiles"("profileNumber");

-- CreateIndex
CREATE INDEX "asset_profiles_status_idx" ON "asset_profiles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "asset_profiles_artworkId_profileType_key" ON "asset_profiles"("artworkId", "profileType");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_assetProfileId_idx" ON "product_variants"("assetProfileId");

-- CreateIndex
CREATE INDEX "product_variants_status_idx" ON "product_variants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "owners_ownerId_key" ON "owners"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "owners_userId_key" ON "owners"("userId");

-- CreateIndex
CREATE INDEX "workspaces_ownerId_idx" ON "workspaces"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_ownerId_workspaceId_key" ON "workspaces"("ownerId", "workspaceId");

-- CreateIndex
CREATE INDEX "items_workspaceId_idx" ON "items"("workspaceId");

-- CreateIndex
CREATE INDEX "items_status_idx" ON "items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "items_ownerId_itemId_key" ON "items"("ownerId", "itemId");

-- CreateIndex
CREATE INDEX "assets_workspaceId_idx" ON "assets"("workspaceId");

-- CreateIndex
CREATE INDEX "assets_itemId_idx" ON "assets"("itemId");

-- CreateIndex
CREATE INDEX "assets_artworkId_idx" ON "assets"("artworkId");

-- CreateIndex
CREATE INDEX "assets_batchItemId_idx" ON "assets"("batchItemId");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_ownerId_assetId_key" ON "assets"("ownerId", "assetId");

-- CreateIndex
CREATE INDEX "relationships_workspaceId_idx" ON "relationships"("workspaceId");

-- CreateIndex
CREATE INDEX "relationships_itemId_idx" ON "relationships"("itemId");

-- CreateIndex
CREATE INDEX "relationships_artworkId_idx" ON "relationships"("artworkId");

-- CreateIndex
CREATE INDEX "relationships_relationshipType_idx" ON "relationships"("relationshipType");

-- CreateIndex
CREATE INDEX "relationships_status_idx" ON "relationships"("status");

-- CreateIndex
CREATE UNIQUE INDEX "relationships_ownerId_relationshipId_key" ON "relationships"("ownerId", "relationshipId");

-- CreateIndex
CREATE INDEX "relationship_members_assetId_idx" ON "relationship_members"("assetId");

-- CreateIndex
CREATE INDEX "relationship_members_sortOrder_idx" ON "relationship_members"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_members_relationshipId_assetId_key" ON "relationship_members"("relationshipId", "assetId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_workspaceId_idx" ON "documents"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_ownerId_documentId_key" ON "documents"("ownerId", "documentId");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "artworks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_assetProfileId_fkey" FOREIGN KEY ("assetProfileId") REFERENCES "asset_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_profiles" ADD CONSTRAINT "asset_profiles_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "artworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_assetProfileId_fkey" FOREIGN KEY ("assetProfileId") REFERENCES "asset_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owners" ADD CONSTRAINT "owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "artworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "batch_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "artworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_members" ADD CONSTRAINT "relationship_members_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "relationships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_members" ADD CONSTRAINT "relationship_members_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
