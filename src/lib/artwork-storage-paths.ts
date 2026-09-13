import path from 'node:path';

export function getManagedArtworkDirectory(uploadPath: string | null | undefined) {
  if (!uploadPath) return null;
  const workingDirectory = path.dirname(path.resolve(uploadPath));
  if (path.basename(workingDirectory).toLowerCase() !== 'working') return null;
  const vectorForgeDirectory = path.dirname(workingDirectory);
  if (path.basename(vectorForgeDirectory).toLowerCase() !== 'vectorforge') return null;
  return path.dirname(vectorForgeDirectory);
}

export function isPathInside(parentPath: string, childPath: string) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function remapPathWithinDirectory(
  value: string | null,
  sourceDirectory: string,
  destinationDirectory: string,
  relativeRenames?: Map<string, string>
) {
  if (!value) return null;
  const absolute = path.resolve(value);
  if (!isPathInside(sourceDirectory, absolute)) return value;
  const oldRelative = path.relative(sourceDirectory, absolute);
  return path.join(destinationDirectory, relativeRenames?.get(oldRelative) ?? oldRelative);
}
