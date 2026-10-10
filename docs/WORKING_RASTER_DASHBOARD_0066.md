# VectorForge v0.66.0 Working Raster and Dashboard Repair

## Working raster actions

- Opening the current raster editor now first ensures the persistent working
  image is a JPG.
- Blur/upscale preparation uses that same current working JPG rather than
  reopening a WEBP, PNG, or protected original.
- A failed open, PNG creation, PNG editor launch, or JPG-ready action remains
  visible in a red on-page error panel.

## Dashboard layout

- Artwork controls now span the top of the dashboard above the image pane.
- The left section is dedicated to the larger, independently scrollable
  category tree.

No database migration or artwork-file migration is required.
