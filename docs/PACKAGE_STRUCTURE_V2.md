# VectorForge Package Structure V2

## Purpose

VectorForge V2 packages need to support digital asset sales, laser products, vinyl products, CNC products, sewing or pattern products, print products, marketplace listing assets, customer download ZIPs, internal automation, and future listing software import.

The core principle is to organize by asset or product purpose, not only by file type.

## Future Root Package Folder

Example:

```text
ART-000125_WilleyECoyote/
  _internal/
  artwork/
  digital/
  laser/
  vinyl/
  cnc/
  sewing/
  print/
  marketplace/
  metadata/
```

The database remains the source of truth for artwork identity, asset profiles, SKUs, marketplace listings, and issued numbers. Folder names are useful for humans, but they must not become the identity system.

## _internal/

Purpose: VectorForge and future listing software automation files.

Contains:

- `manifest.json`
- `processing-history.json`
- `ai-metadata.json` if separated later
- debug metadata if needed
- internal logs or references

Rules:

- Never include in customer download ZIPs.
- Never upload directly to marketplaces as customer files.
- Listing software may read these files.
- Manifest lives here in the future.

## artwork/

Purpose: Shared master artwork files.

Contains:

- original upload
- master SVG
- master PNG
- master JPG
- cleaned or preprocessed source if needed

Rules:

- These are common source files used by profiles.
- These are not necessarily customer-facing by default.
- These may be included in digital downloads only if selected.

## digital/

Purpose: Digital download asset profile.

Suggested subfolders:

```text
digital/downloads/
digital/listing-images/
digital/composite-images/
digital/metadata/
digital/package/
```

Contains:

- customer-facing SVG, PNG, JPG, DXF, PDF, and EPS files as applicable
- digital README
- digital license
- digital ZIP package
- digital listing images

The `digital/` folder should be self-contained enough to copy or export as the digital product package.

## laser/

Purpose: Laser-cut product or profile files.

Suggested subfolders:

```text
laser/production-files/
laser/listing-images/
laser/composite-images/
laser/metadata/
laser/package/
laser/variants/
```

Contains:

- laser-ready SVG, DXF, and PDF files
- size-specific variants
- quantity-specific variant data
- production notes
- listing images
- laser README and license

## vinyl/

Purpose: Vinyl, decal, or cut product profile files.

Suggested subfolders:

```text
vinyl/production-files/
vinyl/listing-images/
vinyl/composite-images/
vinyl/metadata/
vinyl/package/
vinyl/variants/
```

Contains:

- vinyl-ready SVG, PNG, and DXF files
- size and color variants
- transfer or instruction metadata
- listing images

## cnc/

Purpose: CNC product or profile files.

Suggested subfolders:

```text
cnc/production-files/
cnc/listing-images/
cnc/composite-images/
cnc/metadata/
cnc/package/
cnc/variants/
```

Contains:

- CNC-ready vector files
- toolpath or source-prep files later
- dimensions and material notes
- listing images

## sewing/

Purpose: Sewing or pattern profile files.

Suggested subfolders:

```text
sewing/production-files/
sewing/listing-images/
sewing/composite-images/
sewing/metadata/
sewing/package/
sewing/variants/
```

Contains:

- pattern files
- printable PDFs later
- instructions
- size variants

## print/

Purpose: Print, sublimation, or printable profile files.

Suggested subfolders:

```text
print/production-files/
print/listing-images/
print/composite-images/
print/metadata/
print/package/
print/variants/
```

Contains:

- print-ready PNG and PDF files
- mockups
- size and color variants

## marketplace/

Purpose: Marketplace-level shared listing assets.

Suggested subfolders:

```text
marketplace/etsy/
marketplace/shopify/
marketplace/bigcommerce/
marketplace/ebay/
marketplace/custom/
```

Each marketplace folder may contain:

- listing image exports
- listing videos
- platform-specific titles, descriptions, and tags
- marketplace upload CSVs
- listing export manifests

Rules:

- Marketplace files are for listing creation, not necessarily customer downloads.
- Etsy may allow 20 images and 2 videos.
- Other marketplaces may have different limits.
- Marketplace profiles define slot counts and rules.

## metadata/

Purpose: Shared human-readable metadata and documentation.

Contains:

- README templates or generated README files
- license files
- instructions
- notes
- general listing metadata
- support information

Rules:

- Some files here may be copied into customer packages.
- Some files may be internal only depending on profile.

## Customer ZIP Rules

Customer ZIPs should include only customer-facing files.

Examples:

- digital downloads
- README
- license
- instructions

Customer ZIPs should not include:

- `_internal/`
- `manifest.json`
- processing logs
- debug files
- local machine paths
- raw internal metadata

## Internal Package Rules

Internal package exports may include everything:

- `artwork/`
- profile folders
- marketplace files
- `metadata/`
- `_internal/`

Internal exports are for VectorForge, future listing software, backup, migration, and automation workflows. They are not the same thing as customer digital download ZIPs.

## Manifest Rules

Current V1:

- `manifest.json` exists in the root item output folder.
- `manifest.json` is excluded from customer ZIP packages.
- Current generated manifests use additive schema version `2.0`.
- Root `manifest.json` remains supported while the package folder structure is still flat.

Future V2:

- `manifest.json` should move to `_internal/manifest.json`.
- Listing software may read a root manifest from V1 packages.
- Listing software may read `_internal/manifest.json` from V2 packages.
- Listing software should check `_internal/manifest.json` first, then fall back to root `manifest.json`.
- Listing software must not require VectorForge packages.
- Customer ZIP packages must exclude both root `manifest.json` and anything under `_internal/`.

File path rules:

- Manifests use relative paths.
- Distributable metadata must not contain absolute local paths.
- Local debug paths may exist only in optional `localDebug` sections if needed.

Manifest schema version `2.0` is intended to become the portable package interchange format for VectorForge, listing tools, marketplace upload tools, analytics, accounting, order systems, communication tools, and future APIs. It is additive: existing V1-compatible fields remain in place while new sections provide richer package identity, ownership, external references, rights, readiness, processing history, and extension data.

V2 manifest additions include:

- `package`: deterministic package identity, package type, and package status.
- `owner`: optional company, brand, and user references.
- `externalRefs`: optional IDs from VectorForge, listing tools, and marketplaces.
- `rights`: ownership and license metadata.
- `readiness`: package completeness flags for downstream automation.
- `processingHistory`: append-only application steps and settings summaries.
- `extensions`: tool-specific data for listing, analytics, accounting, and marketplace sync systems.
- `productProfiles`: preferred future profile field.

Compatibility rules:

- `assetProfiles` remains in generated manifests for older tools.
- `productProfiles` is preferred for new tools.
- During transition, `assetProfiles` and `productProfiles` may contain equivalent profile data.
- `packageId` is deterministic for now, such as `PKG-ART-000125-DIGI-000125`.
- A separate package numbering sequence is not required until VectorForge needs multiple independently issued packages for the same artwork/profile.
- File entry checksums and fingerprints are reserved for future additions and may be empty until checksum generation is implemented.

## Listing Metadata

The manifest also includes a platform-neutral `listing` section for reusable product marketing data.

Purpose:

- Store listing copy and product metadata once, in a way future listing software can consume.
- Keep the data platform-neutral so it can be mapped to Etsy, Shopify, eBay, or future systems later.
- Avoid hard-coding marketplace-specific fields into the package schema.
- Allow VectorForge and future Listing Software to edit the same generic metadata without changing the package identity model.

Current V2 listing metadata fields:

- `title`
- `shortTitle`
- `description`
- `shortDescription`
- `bulletPoints`
- `tags`
- `keywords`
- `category`
- `subcategory`
- `style`
- `occasion`
- `holiday`
- `audience`
- `suggestedPrice`
- `currency`
- `notes`

Rules:

- New manifests should emit the `listing` section even when all values are empty.
- Existing manifests without `listing` should still be loadable by downstream tools.
- Future listing software may enrich or map these fields to marketplace-specific payloads, but the manifest itself stays platform-neutral.
- The manifest remains the source of truth for generic listing metadata.
- Marketplace-specific metadata should live in downstream Listing Software, not in the package manifest.
- VectorForge may edit these fields now, and Listing Software may edit the same fields later.

## Asset Profile Principle

Each asset profile folder should be self-contained enough that it can be copied or exported by itself.

Examples:

- `digital/` should contain everything needed for the digital product.
- `laser/` should contain everything needed for the laser product.
- `vinyl/` should contain everything needed for the vinyl product.

Shared source files stay in `artwork/`.

## Bundle Packages

A bundle package is a first-class package composed of multiple existing completed packages. Original package folders remain unchanged. The bundle package references those source packages, copies selected customer-facing files into its own bundle staging area, and creates its own customer bundle ZIP.

Bundle packages use their own issued number sequence:

```text
BNDL-000001
BNDL-000002
BNDL-000003
```

The bundle package ID should match the issued bundle number:

```text
package.packageId: BNDL-000001
package.packageType: bundle-package
```

Suggested bundle output location:

```text
output/
  bundles/
    BNDL-000001_FamilyBorderBundle/
      _internal/
        manifest.json
      metadata/
        README.txt
        LICENSE.txt
      members/
        DadBorder/
        MomBorder/
        GrandpaBorder/
      package/
        BNDL-000001_FamilyBorderBundle.zip
```

The customer bundle ZIP should contain customer-facing files only:

```text
DadBorder/
MomBorder/
GrandpaBorder/
README.txt
LICENSE.txt
```

Bundle manifests are the source of truth for bundle membership. Source package manifests may later receive a lightweight `bundleMembership` marker, but that marker is informational only. A missing or stale marker must not invalidate a bundle if the bundle manifest is complete.

Example original-manifest marker:

```json
{
  "bundleMembership": [
    {
      "bundleId": "BNDL-000001",
      "bundleTitle": "Family Border Bundle",
      "bundleManifestPath": "../bundles/BNDL-000001_FamilyBorderBundle/_internal/manifest.json",
      "status": "active",
      "addedAt": "2026-06-18T00:00:00.000Z"
    }
  ]
}
```

Rules for the marker:

- `bundleMembership` is informational only.
- Duplicate `bundleId` entries should be updated in place, not appended twice.
- If a relative `bundleManifestPath` cannot be written safely, the marker may fall back to the `bundleId` only.
- The bundle manifest remains authoritative if there is any disagreement.

Bundle member references should use IDs plus relative source paths:

```json
{
  "sortOrder": 1,
  "packageId": "PKG-ART-000125-DIGI-000125",
  "artworkId": "ART-000125",
  "profileId": "DIGI-000125",
  "productTitle": "Dad Border",
  "sourceManifestPath": "../../ART-000125_DadBorder/manifest.json",
  "sourcePackagePath": "../../ART-000125_DadBorder",
  "bundleFolder": "DadBorder",
  "includedFiles": [
    {
      "role": "primary-svg",
      "sourcePath": "../../ART-000125_DadBorder/dad-border.svg",
      "bundlePath": "members/DadBorder/dad-border.svg",
      "format": "svg"
    }
  ]
}
```

Rules:

- Bundle generation must fail if required member files are missing.
- Bundle ZIPs should not include source package ZIPs unless explicitly selected later.
- Bundle ZIPs should not include `_internal/`, source manifests, processing logs, or debug metadata.
- Bundle folder names are user-facing organization only; `BNDL` numbers and manifests remain the source of truth.
- Bundle membership does not rename or mutate original package folders.

## Future README And Substitution System

README and license files will use substitutions such as:

```text
{{ARTWORK_ID}}
{{PROFILE_ID}}
{{SKU}}
{{PRODUCT_NAME}}
{{COMPANY_NAME}}
{{CONTACT_NAME}}
{{WEBSITE}}
{{EMAIL}}
{{PHONE}}
{{SUPPORT_URL}}
{{CURRENT_YEAR}}
```

The substitution system should support profile-specific and marketplace-specific output without hard-coding the final text in processing services.

## Future Marketplace And Composite System

Composite images will be generated from:

- background
- artwork PNG or mask
- watermark
- optional text layers
- output templates

Composite templates should be profile-specific and marketplace-aware. Marketplace profiles should define slot counts, preferred sizes, accepted formats, and required image or video rules.

## Base Asset Library

The `base-assets/` folder is the source library for reusable template assets. It is not copied wholesale into customer packages.

Current foundation structure:

```text
base-assets/
  templates/
    composites/
    readme/
    license/
  backgrounds/
    digital/
    laser/
    cnc/
    vinyl/
    sewing/
    print/
  watermarks/
    default/
    digital/
    laser/
    cnc/
    vinyl/
    sewing/
    print/
  icons/
  overlays/
```

Folders:

- `templates/composites/`: JSON composite template definitions.
- `templates/readme/`: future README template variants.
- `templates/license/`: future license template variants.
- `backgrounds/`: reusable marketplace or product mockup backgrounds.
- `watermarks/`: reusable watermark images, including default and profile-specific marks.
- `icons/`: reusable graphics for file type, usage, and listing information images.
- `overlays/`: reusable frames, shadows, labels, and decorative layers.

Template asset references should be relative to the `base-assets/` root:

```json
{
  "source": "backgrounds/digital/default-light-wood.jpg"
}
```

Do not require absolute local paths in template JSON. Do not reference package output folders from reusable template files except through symbolic sources such as `primary-png`.

Current working sample assets:

- `backgrounds/digital/default-light-wood.jpg`
- `backgrounds/digital/default-white.jpg`
- `backgrounds/laser/default-workbench.jpg`
- `watermarks/default/vectorforge-sample.png`

## Supplemental Files

Supplemental files are package-specific or bundle-specific extras that are not reusable base-assets.

Examples:

- cutting guide PDF
- assembly instructions
- bonus image
- size chart
- material guide
- extra license addendum
- thank-you note
- marketplace-only promo image
- internal notes

Future package structure:

```text
ART-000125_DadBorder/
  supplemental/
    customer/
    marketplace/
    internal/

BNDL-000001_FamilyBundle/
  supplemental/
    customer/
    marketplace/
    internal/
```

Rules:

- `supplemental/customer/` may later be included in customer ZIPs.
- `supplemental/marketplace/` may later be used by listing or media tools.
- `supplemental/internal/` must never be included in customer ZIPs.
- Supplemental files belong to one package or bundle.
- Base-assets remain the reusable source library and should not be treated as supplemental files.

ZIP guidance:

- Customer ZIPs may include `supplemental/customer/` files when explicitly selected later.
- Customer ZIPs must not include `supplemental/internal/`, `_internal/`, `manifest.json`, or processing logs.
- Marketplace exports may later include `supplemental/marketplace/` files.
- Internal package exports may include all supplemental folders.

## Marketplace Profiles

Marketplace profiles describe channel rules without hard-coding one marketplace into processing logic.

Initial profile keys:

- `etsy`
- `shopify`
- `bigcommerce`
- `ebay`
- `custom`

Each marketplace profile defines:

- marketplace key
- display label
- maximum image count
- maximum video count
- preferred image size
- allowed image formats
- allowed video formats
- whether square images are preferred
- main image rules
- notes

Current Etsy defaults:

- max images: 20
- max videos: 2
- preferred image size: 2000 x 2000
- allowed image formats: JPG and PNG
- square preferred: true

Other marketplace defaults are placeholders and should be editable later.

## Composite Template Storage

Composite templates are data files, not hard-coded rendering logic.

Current planned storage:

```text
base-assets/templates/composites/
  digital-main-mockup.json
  digital-files-included.json
  laser-main-mockup.json
```

Template files should be portable JSON and may reference specific source assets in `base-assets`.

Example template fields:

```json
{
  "id": "digital-main-mockup",
  "name": "Digital Main Mockup",
  "assetProfile": "digital",
  "marketplace": "etsy",
  "outputRole": "main-image",
  "slot": 1,
  "priority": 10,
  "width": 2000,
  "height": 2000,
  "format": "jpg",
  "quality": 90,
  "outputFilename": "{{PROFILE_ID}}-etsy-01-main.jpg",
  "layers": []
}
```

Layer types planned in the schema:

- background
- artwork
- watermark
- mask
- shadow
- text
- border

Text layers are included in the schema for future rendering, but text rendering does not need to be implemented in the data-definition phase.

## Listing Image Output Strategy

Use a hybrid model.

Profile-owned listing images should live under profile folders:

```text
digital/listing-images/
laser/listing-images/
vinyl/listing-images/
cnc/listing-images/
sewing/listing-images/
print/listing-images/
```

Marketplace-specific export sets may later live under marketplace folders:

```text
marketplace/etsy/
marketplace/shopify/
marketplace/bigcommerce/
marketplace/ebay/
marketplace/custom/
```

Reason:

- Most generated images describe an asset profile first.
- Marketplace export folders are channel-specific packaging views.
- Future listing software can import either profile-owned images or marketplace export sets.

Rules:

- Generated listing images may be regenerated.
- Generated listing images should not overwrite manually edited base artwork files.
- Templates should reference specific files and should not copy all of `base-assets`.
- Manifest entries should eventually record marketplace key, asset profile, template ID, output role, slot, dimensions, and format.

## Implementation Phases

Phase 1: Document structure only.

Phase 2: Add helper functions for package paths.

Phase 3: Move manifest to `_internal/manifest.json` while supporting legacy root manifest.

Phase 4: Move current flat outputs into `artwork/` and `digital/` folders for new packages only.

Phase 5: Update ZIP generation to create:

- customer ZIP
- internal package ZIP if needed

Phase 6: Add asset profile support.

Phase 7: Add README and template substitution generation.

Phase 8: Add marketplace and composite image generation.

Path Management Phase 1C:

- Use Working Path for temporary preview files.
- Use Working Path for intermediate upscaled files.
- Use Working Path for queue or worker temp files.
- Use Working Path for composite render temp files if needed.
- Keep Output Path for completed artwork packages.
- Keep Bundle Output Path for future generated bundle packages.
- Keep Archive Path for future archived package storage.

## Do Not Break Rules

- Do not include `_internal` files in customer ZIPs.
- Do not require listing software to use the VectorForge folder structure.
- Do not use filesystem folder names as the source of truth.
- Do not reuse issued ART or profile numbers.
- Do not copy all base-assets into output folders.
- Do not require all users to use the same SKU pattern.
- Do not assume every asset has every profile.
- Do not assume digital, laser, vinyl, CNC, sewing, and print outputs are identical.

## Summary

V2 package structure separates shared artwork, profile-specific deliverables, marketplace listing assets, metadata, and internal automation files. This keeps customer downloads clean while preserving enough package context for VectorForge, future listing software, and internal automation to understand what was generated and why.
