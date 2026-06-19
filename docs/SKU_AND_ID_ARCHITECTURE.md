# SKU and ID Architecture

## Overview

VectorForge intentionally separates four different identifiers:

1. Artwork Identity
2. Asset Profile Identity
3. Product Variant SKU
4. Marketplace Listing Identity

Reason:
A single artwork/design may be sold or produced in many different ways.

Example:
One design called "WilleyECoyote" may become:

* a digital download
* a laser-cut sign
* a vinyl decal
* a CNC file
* a print product
* several Etsy listings
* several Shopify products
* several size/quantity variations

These should not all share one overloaded SKU.

The system needs stable identifiers that can grow over time without breaking old listings, folders, ZIP files, metadata, or marketplace records.

---

## 1. Artwork ID

### Purpose

The Artwork ID is the permanent master identity for the design/artwork itself.

It represents the core creative work, not a specific product, size, material, color, marketplace, or listing.

### Format

```text
ART-000001
ART-000002
ART-000003
```

### Example

```text
ART-000125
Title: WilleyECoyote
```

### Rules

* Assigned once.
* Never reused.
* Never changes.
* Survives deletion of batches/items.
* Represents the root creative work.
* Folder names may include it later, but the database is the source of truth.
* Filesystem names are not the source of truth.

### Future folder example

```text
ART-000125_WilleyECoyote/
```

---

## 2. Asset Profile ID

### Purpose

An Asset Profile ID represents a production or sales category derived from the artwork.

Examples:

* Digital
* Laser
* Vinyl
* CNC
* Sewing
* Print

Each artwork can have multiple asset profiles.

### Format Examples

```text
DIGI-000125
LASR-000125
VNYL-000125
CNC-000125
SEW-000125
PRNT-000125
```

### Example Relationship

Artwork:

```text
ART-000125
Title: WilleyECoyote
```

Asset profiles:

```text
DIGI-000125
LASR-000125
VNYL-000125
CNC-000125
```

### Rules

* Asset Profile IDs are tied to the Artwork numeric sequence.
* If the artwork is `ART-000125`, the digital profile should be `DIGI-000125`.
* If the same artwork later gets a laser profile, it should be `LASR-000125`.
* This keeps all versions of the same artwork easy to identify.
* Profile IDs remain stable once created.

---

## 3. Why Profile IDs Share Artwork Numbers

The preferred model is:

```text
ART-000125
DIGI-000125
LASR-000125
VNYL-000125
```

This makes it immediately clear that all of these are based on the same artwork.

Benefits:

* Easy cross-reference.
* Easier folder organization.
* Easier customer support.
* Easier marketplace tracking.
* Easier future reporting.
* Avoids unrelated independent number sequences.

Alternative independent profile numbering was considered:

```text
ART-000125
DIGI-000042
LASR-000008
```

This was rejected as the default because it makes relationships harder to see without database lookup.

---

## 4. Product Variant SKU

### Purpose

A Product Variant SKU represents the exact thing a customer buys.

This is especially important for physical products where size, quantity, material, color, finish, or packaging may change pricing and inventory.

### Digital Example

```text
DIGI-000125
```

Digital products may not need size or quantity in the SKU if the listing includes all files.

### Laser Examples

```text
LASR-000125-12X12
LASR-000125-18X18
LASR-000125-24X24
```

### Laser Examples With Quantity

```text
LASR-000125-12X12-Q1
LASR-000125-12X12-Q5
LASR-000125-12X12-Q10
```

### Vinyl Examples

```text
VNYL-000125-6X6
VNYL-000125-12X12
VNYL-000125-24X24
```

### Future Color/Material Examples

```text
LASR-000125-12X12-NAT
LASR-000125-12X12-BLK
VNYL-000125-6X6-WHT
```

### General SKU Pattern

```text
[PROFILE]-[ARTWORK_NUMBER]-[SIZE]-[QTY]-[OPTIONAL_COLOR_OR_MATERIAL]
```

Examples:

```text
LASR-000125-12X12-Q5
VNYL-000125-6X6-WHT
CNC-000125-24X36
```

### Rules

* Product Variant SKUs may include dimensions.
* Product Variant SKUs may include quantity.
* Product Variant SKUs may include color/material later if needed.
* Physical-product SKUs should be readable enough to understand what the customer ordered.
* Product Variant SKUs are more specific than Asset Profile IDs.
* Product Variant SKUs may expand over time as more marketplace/product needs are discovered.

---

## 5. Marketplace Listing Identity

Marketplace listing IDs are separate from SKUs.

A single Product Variant SKU may appear on:

* Etsy
* Shopify
* BigCommerce
* eBay
* Other marketplaces

A single marketplace listing may contain:

* multiple images
* multiple videos
* multiple variants
* multiple quantities
* multiple prices

Marketplace IDs should be stored separately from SKUs.

Example:

```text
Artwork:
ART-000125

Asset Profile:
LASR-000125

Product Variants:
LASR-000125-12X12-Q1
LASR-000125-18X18-Q1
LASR-000125-24X24-Q1

Marketplace Listing:
Etsy Listing ID: 1234567890
```

The Etsy listing may contain all three variants.

---

## 5A. Package Identity And Manifest V2

VectorForge package manifests use a separate package identity so future tools can exchange package data without coupling directly to the VectorForge database.

Current Manifest V2 package IDs are deterministic and derived from existing artwork/profile identity:

```text
PKG-ART-000125-DIGI-000125
```

This is not a new permanent numbering sequence yet. It is an interchange identifier for the generated package manifest.

Rules:

* `packageId` identifies a generated package record in `manifest.json`.
* `packageId` does not replace Artwork IDs.
* `packageId` does not replace Asset Profile IDs.
* `packageId` does not replace Product Variant SKUs.
* `packageId` does not replace marketplace listing IDs.
* A dedicated package number sequence may be added later if multiple independent packages are issued for the same artwork/profile.

Manifest V2 keeps `assetProfiles` for backward compatibility and introduces `productProfiles` as the preferred future field. During the transition, both fields may contain equivalent profile data.

---

## 5B. Bundle Package Identity

Bundle packages are products made from multiple existing completed packages. A bundle does not replace the artwork, asset profile, or product variant identities of its member packages.

Bundle packages use a separate permanent number sequence:

```text
BNDL-000001
BNDL-000002
BNDL-000003
```

Example:

```text
ART-000125_DadBorder
ART-000126_MomBorder
ART-000127_GrandpaBorder

becomes:

BNDL-000001_FamilyBorderBundle
```

Rules:

* Bundle numbers are never reused.
* Bundle package IDs should use the bundle number, such as `BNDL-000001`.
* Bundle folders should live under the configured Bundle Output Path.
* Original package folders remain unchanged.
* The bundle manifest is the source of truth for membership.
* Original package manifests may later contain an informational `bundleMembership` marker.
* `bundleMembership` markers are not authoritative and must not replace the bundle manifest.
* Missing required member files should fail bundle generation.

Bundle member references should store package identity and relative source paths:

```text
packageId
artworkId
profileId
sourceManifestPath
sourcePackagePath
bundleFolder
includedFiles
```

This lets future listing tools, marketplace upload tools, analytics, and accounting systems understand a bundle without requiring direct database access.

---

## 6. Numbering System

VectorForge uses a database-backed numbering system.

Core tables:

* NumberSequence
* IssuedNumber

### NumberSequence

Stores sequence configuration.

Fields include:

* sequenceKey
* label
* prefix
* paddingLength
* nextNumber
* lastIssuedNumber
* startingNumber
* isActive
* createdAt
* updatedAt

Example:

```text
sequenceKey: artwork
prefix: ART
paddingLength: 6
nextNumber: 126
```

This produces:

```text
ART-000126
```

Bundle sequence example:

```text
sequenceKey: bundle
prefix: BNDL
paddingLength: 6
nextNumber: 2
```

This produces:

```text
BNDL-000002
```

### IssuedNumber

Stores every issued number permanently.

Fields include:

* issuedNumber
* sequenceKey
* prefix
* numericSequence
* itemId
* batchId
* artworkId
* assetProfileId
* status
* createdAt
* assignedAt
* voidedAt
* notes

### IssuedNumberStatus

Statuses:

```text
ISSUED
ASSIGNED
VOIDED
RETIRED
```

### Rules

* Numbers are never reused.
* Deleted items do not free numbers.
* Voided/retired numbers remain in the ledger.
* Filesystem folders do not determine identity.
* The database is the source of truth.
* Allocation must be transaction-safe.
* The app must not scan folders to decide the next asset number.

---

## 7. Current V1 Assignment Timing

Current V1 behavior:

* Artwork number is assigned on the first successful Approve & Save.
* A default Digital asset profile is created at the same time.
* The BatchItem stores:
  * artworkId
  * assetProfileId
  * artworkNumber
  * profileNumber

Example:

First successful approve/save creates:

```text
ART-000001
DIGI-000001
```

Re-approving the same BatchItem does not allocate a new number.

---

## 8. Current V1 Limitations

Current V1 foundation is partially implemented.

Implemented:

* NumberSequence
* IssuedNumber
* Artwork
* AssetProfile
* ProductVariant
* Artwork/Profile links on BatchItem
* ART and DIGI allocation on first approve/save

Not yet changed:

* Output folder names
* File names
* ZIP names
* SKU format
* Metadata format
* Marketplace listing system
* Asset Profile UI
* Product Variant UI
* Composite Template system

Current legacy SKU example:

```text
DIGI-001-dad-border-001
```

This is expected for now.

Future SKU should use the new identity system.

---

## 9. Future Folder Structure

Future design:

```text
ART-000125_WilleyECoyote/
```

Subfolders:

```text
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

Example:

```text
ART-000125_WilleyECoyote/
artwork/
original/
svg/
png/
jpg/
digital/
laser/
vinyl/
cnc/
sewing/
print/
marketplace/
metadata/
```

Note:
This is future design, not current implementation.

---

## 10. Future File Naming

Future main artwork files:

```text
ART-000125_WilleyECoyote.svg
ART-000125_WilleyECoyote.png
ART-000125_WilleyECoyote.jpg
ART-000125_WilleyECoyote.zip
```

Profile-specific or marketplace-specific files may later live inside profile folders.

---

## 11. Future SKU Generation

Current SKU generation should eventually move from:

```text
DIGI-001-[basename]-001
```

to identity-based SKU generation.

Digital:

```text
DIGI-000125
```

Laser:

```text
LASR-000125-12X12
LASR-000125-18X18
LASR-000125-24X24
```

Laser quantity variants:

```text
LASR-000125-12X12-Q1
LASR-000125-12X12-Q5
LASR-000125-12X12-Q10
```

Vinyl:

```text
VNYL-000125-6X6
VNYL-000125-12X12
```

Future optional color/material:

```text
LASR-000125-12X12-BLK
LASR-000125-12X12-NAT
VNYL-000125-6X6-WHT
```

---

## 12. Migration Plan

### Phase 1: Numbering Foundation

Already implemented or planned:

* Add NumberSequence.
* Add IssuedNumber.
* Add Artwork.
* Add AssetProfile.
* Add ProductVariant.
* Add BatchItem identity links.
* Assign ART and DIGI on first approve/save.

### Phase 2: Artwork/Profile-Aware Output Naming

Future:

* Use artworkNumber in output folder naming.
* Use artworkNumber in file naming.
* Preserve legacy fallback for older test data if needed.

### Phase 3: Variant SKU Generation

Future:

* Add product variant configuration.
* Generate SKUs from:
  * asset profile ID
  * dimensions
  * quantity
  * optional material/color
  * optional version

### Phase 4: Asset Profile UI

Future:

* Enable/disable digital, laser, vinyl, CNC, sewing, print profiles per artwork.
* Create profile folders.
* Configure profile-specific outputs.

### Phase 5: Marketplace Profiles

Future:

* Etsy
* Shopify
* BigCommerce
* eBay
* Custom

Each marketplace profile defines:

* image limits
* video limits
* image size requirements
* export package expectations

### Phase 6: Composite Templates

Future:

* Backgrounds
* Artwork layer
* Masks
* Watermarks
* Text overlays
* Multiple marketplace images

### Phase 7: Marketplace Listing Management

Future:

Track:

* marketplace listing ID
* channel
* listing URL
* variant SKUs
* listing status
* upload/export status

---

## 13. Design Rules

Do not break these rules:

* Artwork IDs never change.
* Artwork IDs are never reused.
* Asset Profile IDs remain tied to Artwork numeric sequence.
* Product Variant SKUs may change/expand.
* Marketplace IDs are separate from SKUs.
* Folder numbering must not determine identity.
* Filesystem names are not the source of truth.
* Database identity is the source of truth.
* Deleted folders do not free up numbers.
* Deleted items do not free up numbers.
* Re-approve/save must not allocate a new Artwork number.
* Retrying must not allocate a new Artwork number.
* Product options belong in Product Variant SKUs, not Artwork IDs.

---

## 14. Practical Examples

### Digital Only

Artwork:

```text
ART-000125
Title: Dad Border
```

Digital Profile:

```text
DIGI-000125
```

Digital SKU:

```text
DIGI-000125
```

Future folder:

```text
ART-000125_DadBorder/
```

### Laser With Sizes

Artwork:

```text
ART-000126
Title: Welcome Sign
```

Laser Profile:

```text
LASR-000126
```

Product Variant SKUs:

```text
LASR-000126-12X12
LASR-000126-18X18
LASR-000126-24X24
```

### Laser With Size And Quantity

Artwork:

```text
ART-000127
Title: Table Numbers
```

Laser Profile:

```text
LASR-000127
```

Product Variant SKUs:

```text
LASR-000127-4X6-Q10
LASR-000127-4X6-Q25
LASR-000127-4X6-Q50
```

### Vinyl With Color

Artwork:

```text
ART-000128
Title: Shop Logo
```

Vinyl Profile:

```text
VNYL-000128
```

Product Variant SKUs:

```text
VNYL-000128-6X6-WHT
VNYL-000128-6X6-BLK
VNYL-000128-12X12-WHT
```

---

## 15. Supplemental Files

Supplemental files are package-specific or bundle-specific extras. They are not reusable base-assets and should not be confused with member files inside bundle packages.

Examples:

* cutting guide PDF
* assembly instructions
* bonus image
* size chart
* material guide
* extra license addendum
* thank-you note
* marketplace-only promo image
* internal notes

Planned folder structure:

```text
ART-000125_DadBorder/
  supplemental/
    customer/
    marketplace/
    internal/
```

Customer supplemental files may later be included in customer ZIPs. Marketplace supplemental files may later be used by listing tools. Internal supplemental files must stay out of customer ZIPs.

---

## 16. Summary

Artwork ID identifies the design.

Asset Profile ID identifies how the design is being used or sold.

Product Variant SKU identifies the exact customer-purchasable option.

Marketplace Listing ID identifies the external marketplace record.

These should remain separate so VectorForge can grow from simple digital file creation into a full product/listing preparation system without corrupting old SKUs or losing traceability.
