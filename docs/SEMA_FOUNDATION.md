# SEMA Foundation

VectorForge is local-first and SEMA-aligned before further feature development.

## Local-First Rules

- Normal desktop use must not require Clerk or a cloud database.
- `LOCAL_AUTH_ENABLED=true` uses a stable local user.
- `DATABASE_URL` should point to local PostgreSQL for desktop use.
- `UPLOAD_DIR`, `OUTPUT_DIR`, `BASE_ASSETS_DIR`, and `LOGS_DIR` may be relative project paths or absolute local filesystem paths.
- Startup and shutdown are handled by `Start VectorForge.bat` and `Stop VectorForge.bat`.

## SEMA Identity Rules

- `OwnerID` is the ownership root.
- `WorkspaceID` scopes local work under an Owner.
- `ItemID` is created before Artwork.
- `ArtworkID` is created under an Item.
- `AssetID` is created with Item and Artwork context.
- Object IDs are immutable and unique within their Owner namespace.
- Global identity is `OwnerID + ObjectType + ObjectID`.

## Upload Flow

The user-facing flow stays simple:

```text
Upload image
Enter title/name
Process
Export
```

The internal flow creates or confirms:

```text
Owner
Workspace
Item
Artwork
source-file Asset
generated Asset records
```

## SEF Export

Package manifests include:

- `OwnerID`
- `WorkspaceID`
- `ItemID`
- `ArtworkID`
- `AssetIDs`
- `sourceApp`
- `createdAt`
- `updatedAt`
- file references
- processing metadata

VectorForge remains marketplace-blind. Marketplace-specific listing rules, marketplace taxonomies, pricing rules, field limits, and API logic belong in downstream Listing Software. VectorForge workspace Categories are application-neutral organizational references and are separate from marketplace categories.

## Additive Foundation Models

The first post-baseline migration adds structures without redirecting the existing upload or processing paths:

- `SemaProfile` isolates each local SEMA account profile.
- `StorageLocation` registers a profile-owned storage root.
- `AssetVersion` records immutable, hashed versions beneath one logical Asset.
- `AssetLocation` stores a relative path beneath a registered Storage Location.
- `Category` forms a cycle-safe, single-parent tree with stable IDs.
- `ItemCategory` allows an Item to belong to multiple Categories.
- `RelationshipCategory` allows Bundles and other Relationships to be categorized without changing their members.
- `DashboardPreference` stores the user's explorer and Category-tree state by context.

Organization and Project Category scopes are reserved in the schema but remain disabled until their membership and permission foundations are implemented.

## Compatibility Boundary

Existing `Asset.filePath`, Batch, upload, processing, Preview/Tune, and Bundle behavior remains operational during this phase. New file writes are not switched to `AssetVersion` or `AssetLocation` until intake and migration services can calculate hashes, verify copies, and roll back failures safely.

All Asset locations added through the new service must be relative to a registered Storage Location. Category membership is logical and never moves or duplicates physical files.

## Bundles

Bundle storage is intentionally not refactored in this phase. Future bundle behavior should treat a bundle as a relationship object referencing `AssetID` values. Export packages may still copy files at export time.
