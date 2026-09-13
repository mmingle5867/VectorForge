# Storage Move and Rename Reliability 0004

## Rename boundary repair

- Rename only operates on a positively identified managed artwork directory with the structure `artwork/<name>/vectorforge/working/<file>`.
- Older upload records can no longer cause the rename service to walk upward into an unrelated parent directory.
- Rename copies to a staging directory, applies filename changes there, commits database path changes, and only then removes the former directory.
- Asset paths, Asset Location relative paths, Item and Artwork titles, BatchItem paths, relationship-member path metadata, and artwork manifests are updated.

## Moving artwork

- Select one or more dashboard files and choose **Move**.
- **Select All Visible** selects the artwork currently shown by the active filters.
- The destination may be a local path, network path, removable drive, or a folder synchronized by software such as Google Drive for desktop.
- VectorForge creates `profiles/<profile-id>/artwork` beneath the entered storage root, preserving per-user isolation.
- The complete artwork directory is copied to a temporary destination first.
- Database paths and registered Asset Locations are updated only after the destination copy succeeds.
- The old directory is removed only after the database transaction succeeds.
- Bundle membership remains connected by immutable AssetID. Cached relationship-member paths are updated.
- A move can optionally make the destination the current user's default import Storage Location.
- Older upload records are migrated into the managed `original` and `vectorforge` structure as part of the move.

## Google Drive scope

This release supports Google Drive through a local folder synchronized by Google Drive for desktop. VectorForge reads and writes that folder as a normal filesystem Storage Location. Direct Google Drive API upload, remote-only browsing, OAuth, and cloud conflict reconciliation are not included in this release.
