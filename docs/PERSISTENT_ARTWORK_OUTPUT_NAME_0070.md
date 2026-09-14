# Persistent Artwork Output Name v0.70.0

Each direct artwork now stores a dedicated `outputBaseName`.

- It is set from the original name at intake.
- Dashboard Rename changes it to the allocated renamed base.
- Raster preparation and editing do not change it.
- Final SVG, PNG, and JPG names always use it.

For existing artwork, the first approval establishes the value from the historical title/original name while removing an old `-edit-v####` or `-working-v####` suffix if present.
