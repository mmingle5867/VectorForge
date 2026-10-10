# Completed Vector Artwork v0.67.0

## Purpose

VectorForge now separates active artwork work from completed vector artwork without moving files. An item is ready for other applications only when it has an active `approved-svg` asset whose review status is `APPROVED`.

## Dashboard behavior

- **Artwork Workspace** lists active, not-yet-ready artwork.
- **Completed Vector Artwork** lists approved vector artwork.
- Items marked **Needs Vector Edit** remain in the Artwork Workspace.
- Categories and permanent SEMA IDs remain unchanged across both views.

## Cross-application contract

The VectorForge application capability is `vectorforge.artwork.ready-for-use`.

- Service: `listReadyVectorArtworkForConsumer(userId)` from `src/services/vectorforge-artwork-readiness.ts`
- Authenticated HTTP read endpoint: `GET /api/artwork/ready`

Each returned record includes the stable artwork ID plus the approved SVG, PNG, and JPG asset references. ListingForge and other applications should consume this contract rather than infer readiness from filenames, folders, or dashboard state.

The endpoint preserves the requesting user boundary. Shared/private policy is intentionally separate and will be added through SEMA access controls.
