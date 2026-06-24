# VTracer Optimization Guide

## Overview

VTracer converts raster images (PNG, JPG, WebP, TIFF) into clean vector SVG files. The quality and file size of the output depends on several configurable parameters.

## Preset Modes

### Balanced (Default)
- Best for most use cases
- Good balance between visual quality and file size
- Recommended for listing images

### Maximum Quality
- Highest fidelity to the original image
- Larger SVG file sizes
- Best for detailed artwork, photography-based vectors
- More paths and anchor points

### Optimized for Size
- Smallest possible SVG output
- Simplified paths, fewer details
- Best for simple logos, icons, and line art
- Faster processing

---

## Parameter Reference

### Color Precision (Range: 4–12, Default: 6)
Controls how many colors are preserved in the output SVG.

| Value | Effect |
|-------|--------|
| 4 | Fewer colors, more posterized look, smaller file |
| 6 | Balanced color representation (default) |
| 8 | More colors preserved, larger file |
| 12 | Maximum color fidelity, largest file |

**Trade-off:** Higher = more accurate colors but larger file size.
**Recommendation:** Use 6 for most designs. Use 8–10 for photographic or gradient-heavy images.

---

### Filter Speckle (Range: 0–20, Default: 4)
Removes small noise artifacts (speckles) from the output.

| Value | Effect |
|-------|--------|
| 0 | No filtering — all details preserved (including noise) |
| 4 | Light filtering — removes tiny artifacts (default) |
| 10 | Moderate filtering — cleaner output, some detail loss |
| 20 | Heavy filtering — very clean but may lose fine details |

**Trade-off:** Higher = cleaner SVG but may lose intentional small details.
**Recommendation:** Use 4 for clean source images. Use 8–12 for scanned or noisy images.

---

### Gradient Step (Range: 8–30, Default: 16)
Controls the number of layers used to represent gradients and color transitions.

| Value | Effect |
|-------|--------|
| 8 | Fewer layers, more banding visible, smaller file |
| 16 | Balanced gradient representation (default) |
| 24 | Smoother gradients, more layers, larger file |
| 30 | Maximum smoothness, largest file |

**Trade-off:** Higher = smoother gradients but more SVG paths.
**Recommendation:** Use 16 for flat designs. Use 24+ for images with smooth color transitions.

---

### Curve Fitting (Options: "spline" | "polygon")
Determines how paths are drawn between anchor points.

| Mode | Effect |
|------|--------|
| spline | Smooth Bézier curves — smaller file, smoother edges |
| polygon | Straight line segments — more accurate to pixel edges |

**Trade-off:** Spline produces smoother, more compact SVGs. Polygon is more accurate but verbose.
**Recommendation:** Use "spline" for most cases. Use "polygon" for pixel art or hard-edged designs.

---

### Corner Threshold (Range: 30–90, Default: 60)
Angle threshold (in degrees) for detecting corners vs. smooth curves.

| Value | Effect |
|-------|--------|
| 30 | More corners detected — sharper, more angular output |
| 60 | Balanced corner detection (default) |
| 90 | Fewer corners — smoother, rounder output |

**Trade-off:** Lower = more angular/sharp. Higher = smoother/rounder.
**Recommendation:** Use 60 for general use. Use 30–45 for geometric designs. Use 75–90 for organic shapes.

---

### Segment Length (Range: 2–12, Default: 4)
Minimum length of path segments. Controls path simplification.

| Value | Effect |
|-------|--------|
| 2 | Short segments — more detail, larger file |
| 4 | Balanced detail (default) |
| 8 | Longer segments — simplified paths, smaller file |
| 12 | Maximum simplification — very clean but less detailed |

**Trade-off:** Lower = more detailed paths. Higher = simpler, smaller SVGs.
**Recommendation:** Use 4 for detailed images. Use 6–8 for simpler graphics.

---

### Splice Threshold (Range: 20–80, Default: 45)
Controls how aggressively adjacent paths are merged.

| Value | Effect |
|-------|--------|
| 20 | Less merging — more individual paths, larger file |
| 45 | Balanced merging (default) |
| 60 | More merging — fewer paths, smaller file |
| 80 | Aggressive merging — minimal paths, may lose detail |

**Trade-off:** Higher = fewer paths (smaller file) but potential detail loss.
**Recommendation:** Use 45 for most cases. Use 60+ for simple designs where file size matters.

---

## Preset Configurations

```json
{
  "balanced": {
    "colorPrecision": 6,
    "filterSpeckle": 4,
    "gradientStep": 16,
    "curveFitting": "spline",
    "cornerThreshold": 60,
    "segmentLength": 4,
    "spliceThreshold": 45
  },
  "maximumQuality": {
    "colorPrecision": 10,
    "filterSpeckle": 2,
    "gradientStep": 24,
    "curveFitting": "spline",
    "cornerThreshold": 70,
    "segmentLength": 2,
    "spliceThreshold": 30
  },
  "optimizedForSize": {
    "colorPrecision": 4,
    "filterSpeckle": 8,
    "gradientStep": 10,
    "curveFitting": "spline",
    "cornerThreshold": 50,
    "segmentLength": 8,
    "spliceThreshold": 65
  }
}
```

## Tips for Best Results

1. **Start with a preset**, then fine-tune individual parameters
2. **Use the Test button** to preview results before processing the full batch
3. **Higher resolution inputs** produce better vectors — upscale first if needed
4. **Clean source images** (no noise, good contrast) convert much better
5. **Simple designs** (logos, icons, line art) work best with "Optimized for Size"
6. **Complex artwork** (illustrations, photos) benefit from "Maximum Quality"
