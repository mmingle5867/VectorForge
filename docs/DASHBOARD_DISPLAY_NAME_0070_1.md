# Dashboard display-name repair 0.70.1

The dashboard now separates the editable working-raster filename from the
artwork's permanent display name.  A versioned working file such as
`duckling-edit-v0002.jpg` remains the preview source, but the dashboard and
completed-artwork view display `duckling.jpg` using the artwork's persisted
output base name.

No database migration is required.  Versioned working files and permanent SEMA
IDs are unchanged.
