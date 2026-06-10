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

export function normalizeSvgRoot(svg: string, width: number, height: number): string {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  const normalizedSvg = svg.replace(/<svg\b[^>]*>/i, (svgTag) => {
    const existingXmlns = svgTag.match(/\sxmlns=(["']).*?\1/i)?.[0] || '';
    return `<svg${existingXmlns || ' xmlns="http://www.w3.org/2000/svg"'} width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" preserveAspectRatio="xMidYMid meet">`;
  });

  return ensureVisiblePathPaint(normalizedSvg);
}
