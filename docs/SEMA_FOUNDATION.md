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

VectorForge remains marketplace-blind. Marketplace-specific listing rules, categories, pricing rules, field limits, and API logic belong in downstream Listing Software.

## Bundles

Bundle storage is intentionally not refactored in this phase. Future bundle behavior should treat a bundle as a relationship object referencing `AssetID` values. Export packages may still copy files at export time.
