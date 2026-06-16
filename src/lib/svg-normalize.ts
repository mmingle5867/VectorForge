function pathHasVisiblePaint(pathTag: string): boolean {
  const fill = pathTag.match(/\sfill=(["'])(.*?)\1/i)?.[2]?.trim().toLowerCase();
  const stroke = pathTag.match(/\sstroke=(["'])(.*?)\1/i)?.[2]?.trim().toLowerCase();

  return fill !== 'none' || (!!stroke && stroke !== 'none');
}

function ensureVisiblePathPaint(svg: string): string {
  const pathTags = svg.match(/<path\b[^>]*>/gi) || [];
  if (pathTags.length === 0 || pathTags.some(pathHasVisiblePaint)) {
    return svg;
  }

  return svg.replace(/<path\b[^>]*>/gi, (pathTag) => {
    if (!/\sfill=(["'])none\1/i.test(pathTag) || /\sstroke=/i.test(pathTag)) {
      return pathTag;
    }

    return pathTag.replace(
      /\/?>$/,
      ' stroke="#000" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"$&'
    );
  });
}

export function normalizeSvgRoot(
  svg: string,
  width: number,
  height: number,
  options: { canvasPaddingPx?: number } = {}
): string {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const padding = Math.max(0, Math.round(options.canvasPaddingPx ?? 0));
  const canvasWidth = safeWidth + padding * 2;
  const canvasHeight = safeHeight + padding * 2;

  const normalizedSvg = svg.replace(/<svg\b[^>]*>/i, (svgTag) => {
    const existingXmlns = svgTag.match(/\sxmlns=(["']).*?\1/i)?.[0] || '';
    return `<svg${existingXmlns || ' xmlns="http://www.w3.org/2000/svg"'} width="${canvasWidth}" height="${canvasHeight}" viewBox="${-padding} ${-padding} ${canvasWidth} ${canvasHeight}" preserveAspectRatio="xMidYMid meet">`;
  });

  return ensureVisiblePathPaint(normalizedSvg);
}

function parseSvgNumber(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^([0-9]*\.?[0-9]+)/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeRasterStrokeWidth(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 4;
}

function setSvgTagAttribute(tag: string, name: string, value: string): string {
  const attrPattern = new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i');
  if (attrPattern.test(tag)) {
    return tag.replace(attrPattern, ` ${name}="${value}"`);
  }

  return tag.replace(/\s*\/?>$/, (ending) => ` ${name}="${value}"${ending}`);
}

function getStyleDeclaration(style: string | undefined, property: string): string | undefined {
  if (!style) return undefined;
  return style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim();
}

function setStyleDeclaration(style: string, property: string, value: string): string {
  const declarationPattern = new RegExp(`(^|;)\\s*${property}\\s*:\\s*[^;]+`, 'i');
  if (declarationPattern.test(style)) {
    return style.replace(declarationPattern, (_match, prefix: string) => `${prefix} ${property}: ${value}`);
  }

  const trimmed = style.trim().replace(/;$/, '');
  return trimmed ? `${trimmed}; ${property}: ${value}` : `${property}: ${value}`;
}

function getTagAttribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i'))?.[2];
}

function getTagStrokeWidth(tag: string): number | null {
  const attrWidth = parseSvgNumber(getTagAttribute(tag, 'stroke-width'));
  const styleWidth = parseSvgNumber(getStyleDeclaration(getTagAttribute(tag, 'style'), 'stroke-width'));
  const widths = [attrWidth, styleWidth].filter((value): value is number => value !== null);
  return widths.length > 0 ? Math.max(...widths) : null;
}

function setPaintableRasterStroke(tag: string, strokeColor: string, strokeWidth: number): string {
  const existingStrokeWidth = getTagStrokeWidth(tag);
  const rasterStrokeWidth = Math.max(existingStrokeWidth ?? 0, safeRasterStrokeWidth(strokeWidth));
  const style = getTagAttribute(tag, 'style') ?? '';
  let updated = tag;

  const nextStyle = [
    ['fill', 'none'],
    ['stroke', strokeColor],
    ['stroke-width', String(rasterStrokeWidth)],
  ].reduce((current, [property, value]) => setStyleDeclaration(current, property, value), style);
  updated = setSvgTagAttribute(updated, 'style', nextStyle);

  updated = setSvgTagAttribute(updated, 'fill', 'none');
  updated = setSvgTagAttribute(updated, 'stroke', strokeColor);
  updated = setSvgTagAttribute(updated, 'stroke-width', String(rasterStrokeWidth));

  return updated;
}

function getRootAttribute(svgTag: string, name: string): string | undefined {
  return svgTag.match(new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i'))?.[2];
}

function getSvgDimensions(svgTag: string) {
  const viewBox = getRootAttribute(svgTag, 'viewBox');
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3], viewBox };
    }
  }

  const width = parseSvgNumber(getRootAttribute(svgTag, 'width'));
  const height = parseSvgNumber(getRootAttribute(svgTag, 'height'));
  if (width && height) {
    return { width, height, viewBox: `0 0 ${width} ${height}` };
  }

  return { width: 1000, height: 1000, viewBox: '0 0 1000 1000' };
}

function isNonePaint(value: string | undefined): boolean {
  return !!value && value.trim().toLowerCase() === 'none';
}

function isHiddenByOpacity(tag: string, paintType: 'fill' | 'stroke'): boolean {
  const opacity = tag.match(/\sopacity=(["'])(.*?)\1/i)?.[2]?.trim();
  const paintOpacity = tag.match(new RegExp(`\\s${paintType}-opacity=(["'])(.*?)\\1`, 'i'))?.[2]?.trim();
  return opacity === '0' || opacity === '0.0' || paintOpacity === '0' || paintOpacity === '0.0';
}

function hasExplicitVisibleFill(tag: string): boolean {
  const styleFill = getStyleDeclaration(getTagAttribute(tag, 'style'), 'fill')?.toLowerCase();
  const fill = (styleFill || tag.match(/\sfill=(["'])(.*?)\1/i)?.[2])?.trim().toLowerCase();
  return !!fill && fill !== 'none' && !isHiddenByOpacity(tag, 'fill');
}

function hasVisibleStroke(tag: string): boolean {
  const styleStroke = getStyleDeclaration(getTagAttribute(tag, 'style'), 'stroke')?.toLowerCase();
  const stroke = (styleStroke || tag.match(/\sstroke=(["'])(.*?)\1/i)?.[2])?.trim().toLowerCase();
  return !!stroke && stroke !== 'none' && !isHiddenByOpacity(tag, 'stroke');
}

function classifySvgPaint(svg: string) {
  const paintableTags = svg.match(/<(?:path|circle|ellipse|rect|line|polyline|polygon)\b[^>]*>/gi) || [];
  const styleBlocks = svg.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi)?.join('\n') || '';
  const hasCssFill = /(?:^|[;{\s])fill\s*:\s*(?!none\b)(#[0-9a-fA-F]{3,8}|rgb|hsl|[a-zA-Z])/i.test(styleBlocks);
  const hasVisibleFill = hasCssFill || paintableTags.some(hasExplicitVisibleFill);
  const hasStroke = paintableTags.some(hasVisibleStroke) || /(?:^|[;{\s])stroke\s*:\s*(?!none\b)/i.test(styleBlocks);
  const hasFillNone = paintableTags.some((tag) =>
    isNonePaint(getStyleDeclaration(getTagAttribute(tag, 'style'), 'fill') || tag.match(/\sfill=(["'])(.*?)\1/i)?.[2])
  );

  return {
    hasFilledColors: hasVisibleFill || (!hasStroke && !hasFillNone),
    isStrokeOnly: !hasVisibleFill && hasStroke,
  };
}

export function isSvgMimeOrPath(mimeType: string | null | undefined, filePath: string | null | undefined) {
  return mimeType === 'image/svg+xml' || !!filePath?.toLowerCase().endsWith('.svg');
}

export function normalizeImportedSvg(
  svg: string,
  options: { canvasPaddingPx?: number } = {}
) {
  const rootSvgTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!rootSvgTag) {
    throw new Error('Input is not a valid SVG');
  }

  const dimensions = getSvgDimensions(rootSvgTag);
  const safeWidth = Math.max(1, Math.round(dimensions.width));
  const safeHeight = Math.max(1, Math.round(dimensions.height));
  const padding = Math.max(0, Math.round(options.canvasPaddingPx ?? 0));
  const canvasWidth = safeWidth + padding * 2;
  const canvasHeight = safeHeight + padding * 2;
  const viewBoxParts = dimensions.viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const paddedViewBox =
    viewBoxParts.length === 4 && viewBoxParts.every(Number.isFinite)
      ? `${viewBoxParts[0] - padding} ${viewBoxParts[1] - padding} ${viewBoxParts[2] + padding * 2} ${viewBoxParts[3] + padding * 2}`
      : `${-padding} ${-padding} ${canvasWidth} ${canvasHeight}`;
  const paint = classifySvgPaint(svg);
  const normalizedSvg = svg.replace(/<svg\b[^>]*>/i, (svgTag) => {
    const existingXmlns = svgTag.match(/\sxmlns=(["']).*?\1/i)?.[0] || '';
    return `<svg${existingXmlns || ' xmlns="http://www.w3.org/2000/svg"'} width="${canvasWidth}" height="${canvasHeight}" viewBox="${paddedViewBox}" preserveAspectRatio="xMidYMid meet">`;
  });

  return {
    svg: normalizedSvg,
    width: canvasWidth,
    height: canvasHeight,
    hasFilledColors: paint.hasFilledColors,
    isStrokeOnly: paint.isStrokeOnly,
  };
}

export function prepareStrokeOnlySvgForRaster(
  svg: string,
  options: { strokeColor: string; strokeWidth: number }
) {
  return svg.replace(/<(?:path|circle|ellipse|rect|line|polyline|polygon)\b[^>]*>/gi, (tag) =>
    setPaintableRasterStroke(tag, options.strokeColor, options.strokeWidth)
  );
}
