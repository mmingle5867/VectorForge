# VectorForge V1 Workflow

This document describes the current working V1 review, edit, and finalization workflow. It is intended as internal implementation reference for preserving the current behavior while planning later improvements.

## Item Lifecycle

### PENDING

- New upload.
- Must be reviewed before conversion.
- Shows `Review/Tune` only.
- Cannot be processed or finalized.

### NEEDS_MANUAL_EDIT

- Review has started, but the item is not ready for final processing.
- User may need to fill or edit the generated PNG/JPG files manually.
- Shows `Continue Editing`, `Open Editable Files`, and `Mark Ready To Process`.
- Cannot be processed or finalized until marked `READY_TO_PROCESS`.

### READY_TO_PROCESS

- Reviewed and base files are acceptable.
- Shows `Start Conversion` or `Process Item`.
- Only this status can be finalized.
- Finalization uses the existing saved base SVG/PNG/JPG files.

### PROCESSING

- Finalization/package generation is running.
- The item or batch should not accept review-state changes while processing is active.

### COMPLETED

- Final package generation succeeded.
- Shows `Open Output Folder` and `Download ZIP`.
- Item is marked complete only after final package generation succeeds.

### FAILED

- Something failed during processing.
- Shows retry and edit options where available.
- The user can retry failed work or return to review/edit flows depending on the item state and available saved outputs.

### CANCELLED

- Item or batch was cancelled.
- Cancelled items are excluded from batch readiness checks.

## Current Workflow

```text
Upload
-> PENDING
-> Review/Tune
-> Save base outputs
-> NEEDS_MANUAL_EDIT or READY_TO_PROCESS
-> Start Conversion
-> Final package generation
-> COMPLETED
```

The review step creates or updates base outputs. The conversion step finalizes already saved base outputs into the package artifacts.

## Raster Workflow

Raster uploads currently follow this path:

- JPG/PNG import.
- User opens `Preview/Tune`.
- VTracer generates an SVG preview from the raster source.
- Approve/save creates SVG/PNG/JPG base outputs.
- User marks the item `NEEDS_MANUAL_EDIT` or `READY_TO_PROCESS`.
- Start Conversion finalizes the package.

If manual editing is needed, the saved PNG/JPG files can be opened externally and edited before the item is marked `READY_TO_PROCESS`.

## SVG Workflow

SVG uploads currently follow this path:

- SVG import.
- User opens `Preview/Tune`.
- VTracer is skipped.
- Approve/save creates a normalized SVG plus PNG/JPG base outputs.
- User edits or fills files if needed.
- User marks the item `READY_TO_PROCESS`.
- Start Conversion finalizes the package.

SVG review should preserve the source intent while producing the normalized base outputs required by the final package step.

## Start Conversion Rules

- Batch Start Conversion only appears when all non-cancelled items are `READY_TO_PROCESS`.
- Individual Start Conversion/Process Item only appears for `READY_TO_PROCESS` items.
- `PENDING` items cannot be converted.
- `NEEDS_MANUAL_EDIT` items cannot be converted.
- Start Conversion does not rerun tracing.
- Start Conversion finalizes existing base SVG/PNG/JPG files.

## Finalization

Finalization should:

- Use the current saved SVG/PNG/JPG files.
- Preserve manually edited PNG/JPG files.
- Create or refresh marketplace preview/composites when configured.
- Create the SKU file.
- Create listing metadata.
- Create the ZIP last.
- Mark the item `COMPLETED` only after success.

Finalization is the only step that should create the final package artifacts and move an item to `COMPLETED`.

## Output And Package Behavior

- Output folders are reused for the same item when existing saved outputs are present.
- Package filenames are deterministic.
- ZIP files are written to the item output/package location used by the finalization step.
- ZIP creation excludes ZIP files so previous packages are not nested into new packages.
- `base-assets` are not copied automatically unless the copy setting is enabled.
- `base-assets` should remain a source asset library, not a per-output dump.

Output folder numbering and package naming should remain stable and predictable for the user.

## Dashboard Behavior

- Batch cards show item status counts.
- Expanded batch view shows individual items.
- Item-level actions depend on item status.
- Batch-level actions depend on the statuses of the items in the batch.

The dashboard should make it clear whether a batch needs review, manual edits, final processing, retry, or output inspection.

## External Editor Workflow

- The manual editor path is configured in settings.
- PNG/JPG files can be opened in Paint.NET or another configured editor.
- Multiple files can be opened if the setting is enabled.
- This is a local-only feature.

The external editor workflow is intended for manual cleanup/fill work on saved base outputs before final processing.

## Known Future Improvements

- Asset profiles:
  - digital
  - laser
  - vinyl
  - CNC
  - sewing
  - print
- Asset-profile folder structure.
- README/template substitution system.
- Composite image system.
- Independent base folders.
- Folder creation/browse tools.
- Oversized image downscaling.
- DXF/PDF/EPS export.
- Modular importer/processor/exporter registry.
- Feature flags/licensing.
- Metadata logging.

These are future enhancements and should not be mixed into cleanup work for the current V1 workflow.

## Do Not Break

- Do not process `PENDING` items.
- Do not process `NEEDS_MANUAL_EDIT` items.
- Do not mark complete before final package generation succeeds.
- Do not rerun tracing during finalization.
- Do not overwrite manually edited PNG/JPG during finalization.
- Do not copy all `base-assets` into every output folder.
- Do not reuse deleted output folder numbers.
- Do not require folders to be relative to the app directory.
