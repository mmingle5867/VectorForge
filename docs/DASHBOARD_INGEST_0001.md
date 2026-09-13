# Dashboard and Ingest Implementation 0001

## Scope

This implementation establishes the first working file-explorer dashboard and
profile-isolated, copy-first artwork intake path. It preserves the existing
VectorForge review, tuning, conversion, output, and bundle routes.

## Storage boundary

The user selects a VectorForge Storage Root in Settings. VectorForge derives a
private profile directory below it:

- `profiles/<profile-id>/processing`
- `profiles/<profile-id>/artwork`
- `profiles/<profile-id>/bundles`

Each distinct storage root is recorded as a separate Storage Location. Changing
the configured root does not repoint Asset Locations that refer to an earlier
Storage Location.

## Intake sequence

1. Browser-selected or browser-dropped files are copied into `processing`.
2. Files placed directly in `processing` are found by the dashboard scan.
3. VectorForge reserves a permanent working-directory name.
4. VectorForge copies the file into an immutable `original` directory.
5. VectorForge creates a separate working copy used by preview and processing.
6. Database Item, Artwork, Asset, Asset Version, and Asset Location references
   are recorded.
7. An initial reference-based manifest is written.
8. The successfully ingested copy is removed from `processing`.

Files that fail intake remain in `processing` so they are not silently lost.

## Per-artwork structure

- `artwork/<base-name>/original/<original-file>`
- `artwork/<base-name>/vectorforge/working/<working-copy>`
- `artwork/<base-name>/vectorforge/vectorized/`
- `artwork/<base-name>/vectorforge/png/`
- `artwork/<base-name>/vectorforge/jpg/`
- `artwork/<base-name>/vectorforge/manifest/manifest.json`

Duplicate base names receive `-0001`, `-0002`, and so on. The next number is
stored in the database before filesystem work begins, so issued suffixes are
never reused even when intake fails or an artwork is later deleted.

## Dashboard behavior

- Open-file selection and drag-and-drop intake
- Five-second watched-folder polling plus a manual Scan Folder command
- Large image, thumbnail, list, and details views
- Name/ID/category search
- Status and file-type filters
- Name, type, status, updated-date, and size sorting
- Database-persisted view, filter, and sorting preferences
- Status-colored cards and filenames
- Right-click commands for processing, opening the working directory, and
  displaying the manifest

## Deferred controls

The dashboard visibly reserves Rename for the next implementation slice.
Multi-selection, safe deletion with bundle-reference enforcement, hierarchical
category editing, bundle creation/addition, and bundle-as-filetype display are
also subsequent slices built on this intake foundation.
