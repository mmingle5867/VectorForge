# VectorForge Raster Preparation and Control Presets 0003

Status: implementation complete  
Migration required: no

## Raster editing workflow

The Preview/Tune raster-editor action now opens a preparation dialog. The user may:

- Open the current working copy without changing it.
- Apply blur from 0.0 through 20.0.
- Upscale at 1x, 2x, or 4x before opening the raster editor.
- Apply blur and upscale together.

The immutable file under `original/` is never changed. When preparation is requested, VectorForge writes a new numbered file under `vectorforge/working/`, creates a new AssetVersion and AssetLocation, makes that version the active working path, and updates the artwork manifest. Earlier working versions remain available.

The dashboard context menu includes `Open in raster editor…`. This opens Preview/Tune for the selected artwork and immediately presents the same preparation dialog.

## Persistent controls

The most recently used Preview/Tune controls and raster preparation values are stored per user. Changes are saved automatically after a short debounce and restored in later sessions.

## Named control presets

A named preset contains:

- Preset ID
- Name
- Description
- Vectorizer Preview/Tune control values
- Raster-editor blur value
- Raster-editor upscale factor
- Created and updated timestamps

Preview/Tune provides a preset selector and `Save Set` action. Settings provides a Control Setting Presets section to create from the current persistent controls, select as the current set, edit the name and description, or delete the preset.

Preset data is stored in the existing per-user settings JSON. No schema or Prisma migration is required.

## Rename and category hardening

- Concurrent rename requests for the same artwork are rejected.
- Filesystem renames are rolled back if the database transaction fails.
- Rename and category failures are returned as visible dashboard notices rather than unhandled client promises.
- Server-side failures include structured log entries and stack information in the local log.

The report that the second rename crashed did not include the failing server or browser error, so its exact historical cause cannot be proven. This revision hardens the identified failure paths and adds the diagnostic information needed to isolate any remaining data-specific case.
