# VectorForge Dashboard Explorer Revision 0002

Status: implementation complete  
Migration required: no

## User-visible changes

- The dashboard displays the editable working copy. The untouched original is shown in the hover card.
- Hover cards are available in Large, Thumbnail, List, and Details layouts and show file details, categories, processing state, and manifest availability.
- Rename is enabled for one selected artwork. It renames the artwork directory, original and working filenames, matching derivative filenames, database paths, asset locations, and the artwork manifest.
- Every layout includes selection checkboxes. Selected files can be categorized, bundled, or (for one file) renamed.
- Categories appear as a persistent tree at the left of the explorer. Users can create root categories and subcategories, filter by a branch, and include descendants.
- Category assignment supports one or many selected files and multiple category memberships.
- Bundles appear on the dashboard as the BUNDLE file type. Selected files can create a logical reference-only bundle or be added to an existing bundle.
- Processing History has its own left-navigation page. The batch/job concept is no longer presented as the primary dashboard object.
- Listing Preview settings are hidden because they belong to ListingForge.
- Status borders are four pixels wide. List and Details filenames are bold.
- Status colors are configurable in Settings and are stored per user.

## Reference behavior

The primary dashboard image always comes from `vectorforge/working`. Editing that file is reflected on the next dashboard reload because image previews are served without a long-lived browser cache. The original under `original/` remains immutable and is served only when the original preview is explicitly requested.

Bundles store AssetID references and do not copy or move artwork. Adding files to a bundle adds relationship members. Existing artwork locations remain authoritative.

## Rename consistency

Rename performs the filesystem rename first, then updates the BatchItem, Item, Artwork, Asset, and AssetLocation records. Matching derivative names and JSON manifest references are updated. A rename is rejected if the destination artwork directory or a destination filename already exists.

## Deliberate boundary

Bundle export/regeneration remains on the Bundles pages. The dashboard creates and updates logical bundles. Category move, category rename, category retirement, drag-and-drop tree reordering, and deletion safeguards remain separate administrative operations for a later revision.
