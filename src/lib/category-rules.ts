export const ROOT_CATEGORY_PARENT_KEY = '__ROOT__';

export type CategoryParentRecord = {
  id: string;
  parentId: string | null;
};

export function normalizeCategoryName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

export function validateCategoryName(value: string): string {
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');

  if (!name) {
    throw new Error('Category name is required');
  }

  if (name.length > 120) {
    throw new Error('Category name cannot exceed 120 characters');
  }

  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Category name cannot contain control characters');
  }

  return name;
}

export function parentKeyFor(categoryId: string | null | undefined): string {
  return categoryId ?? ROOT_CATEGORY_PARENT_KEY;
}

export function assertNoCategoryCycle(
  categoryId: string,
  newParentId: string | null,
  records: readonly CategoryParentRecord[]
): void {
  if (!newParentId) {
    return;
  }

  const parentById = new Map(records.map((record) => [record.id, record.parentId]));
  const visited = new Set<string>();
  let cursor: string | null = newParentId;

  while (cursor) {
    if (cursor === categoryId) {
      throw new Error('A category cannot be moved beneath itself or one of its descendants');
    }

    if (visited.has(cursor)) {
      throw new Error('The existing category tree contains a cycle');
    }

    visited.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
}
