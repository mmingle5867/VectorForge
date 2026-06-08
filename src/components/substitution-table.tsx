'use client';

import { useState, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface SubstitutionRow {
  id: string;
  key: string;
  value: string;
}

interface SubstitutionTableProps {
  rows: SubstitutionRow[];
  onChange: (rows: SubstitutionRow[]) => void;
  readOnly?: boolean;
  maxRows?: number;
  showPlaceholders?: boolean;
  compact?: boolean;
}

// ============================================================================
// Utility
// ============================================================================

let counter = 0;
function generateId(): string {
  return `sub_${Date.now()}_${++counter}`;
}

export function rowsToObject(rows: SubstitutionRow[]): Record<string, string> {
  const obj: Record<string, string> = {};
  rows.forEach((row) => {
    if (row.key.trim()) {
      obj[row.key.trim()] = row.value;
    }
  });
  return obj;
}

export function objectToRows(obj: Record<string, string>): SubstitutionRow[] {
  return Object.entries(obj).map(([key, value]) => ({
    id: generateId(),
    key,
    value,
  }));
}

// ============================================================================
// SubstitutionTable Component
// ============================================================================

export default function SubstitutionTable({
  rows,
  onChange,
  readOnly = false,
  maxRows = 50,
  showPlaceholders = true,
  compact = false,
}: SubstitutionTableProps) {
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set());

  // Validate for duplicate keys
  const validateDuplicates = useCallback((currentRows: SubstitutionRow[]) => {
    const keyCount: Record<string, number> = {};
    currentRows.forEach((row) => {
      const k = row.key.trim().toLowerCase();
      if (k) {
        keyCount[k] = (keyCount[k] || 0) + 1;
      }
    });
    const dupes = new Set<string>();
    Object.entries(keyCount).forEach(([k, count]) => {
      if (count > 1) dupes.add(k);
    });
    setDuplicateKeys(dupes);
  }, []);

  // Add a new row
  const addRow = () => {
    if (rows.length >= maxRows) return;
    const newRows = [...rows, { id: generateId(), key: '', value: '' }];
    onChange(newRows);
  };

  // Update a row field
  const updateRow = (id: string, field: 'key' | 'value', val: string) => {
    const newRows = rows.map((row) =>
      row.id === id ? { ...row, [field]: val } : row
    );
    onChange(newRows);
    if (field === 'key') {
      validateDuplicates(newRows);
    }
  };

  // Remove a row
  const removeRow = (id: string) => {
    const newRows = rows.filter((row) => row.id !== id);
    onChange(newRows);
    validateDuplicates(newRows);
  };

  // Check if a key is duplicate
  const isDuplicate = (key: string): boolean => {
    return duplicateKeys.has(key.trim().toLowerCase());
  };

  // Check if a key is empty (only show error if value is non-empty)
  const isEmptyKey = (row: SubstitutionRow): boolean => {
    return row.key.trim() === '' && row.value.trim() !== '';
  };

  const paddingClass = compact ? 'p-4' : 'p-6';
  const gapClass = compact ? 'gap-1.5' : 'gap-2';

  return (
    <div className={`rounded-xl border border-gray-200 bg-white ${paddingClass} shadow-sm dark:border-gray-700 dark:bg-gray-800`}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-gray-900 dark:text-white`}>
            Substitution Variables
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
            {rows.length}{maxRows < 50 ? `/${maxRows}` : ''}
          </span>
        </div>
        {!readOnly && (
          <button
            onClick={addRow}
            disabled={rows.length >= maxRows}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Variable
          </button>
        )}
      </div>

      {/* Info Banner */}
      {showPlaceholders && rows.length > 0 && (
        <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          <strong>Tip:</strong> Use dynamic placeholders in values: <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">{'{BASENAME}'}</code>, <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">{'{SKU}'}</code>, <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">{'{DATE}'}</code>, <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">{'{WIDTH}'}</code>, <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">{'{HEIGHT}'}</code>
        </div>
      )}

      {/* Empty State */}
      {rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-600">
          <svg className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            No substitution variables defined.
          </p>
          {!readOnly && (
            <button
              onClick={addRow}
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add First Variable
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className={`space-y-${compact ? '1.5' : '2'}`}>
          {/* Column Headers */}
          <div className={`grid ${readOnly ? 'grid-cols-[1fr_2fr]' : 'grid-cols-[1fr_2fr_36px]'} ${gapClass} px-1`}>
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Key
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Value
            </span>
            {!readOnly && <span className="w-9" />}
          </div>

          {/* Rows */}
          {rows.map((row) => {
            const hasDuplicateError = isDuplicate(row.key);
            const hasEmptyKeyError = isEmptyKey(row);

            return (
              <div
                key={row.id}
                className={`grid ${readOnly ? 'grid-cols-[1fr_2fr]' : 'grid-cols-[1fr_2fr_36px]'} ${gapClass} items-center`}
              >
                {/* Key Input */}
                <div className="relative">
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                    readOnly={readOnly}
                    placeholder={showPlaceholders ? 'e.g. Title' : 'Key'}
                    className={`w-full rounded-md border px-2.5 py-1.5 text-sm transition-colors focus:outline-none focus:ring-1 ${
                      hasDuplicateError || hasEmptyKeyError
                        ? 'border-red-400 bg-red-50 text-red-900 focus:border-red-500 focus:ring-red-500 dark:border-red-500 dark:bg-red-900/20 dark:text-red-300'
                        : 'border-gray-300 bg-white text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white'
                    } ${readOnly ? 'cursor-default bg-gray-50 dark:bg-gray-800' : ''}`}
                  />
                  {hasDuplicateError && (
                    <span className="absolute -bottom-4 left-0 text-[10px] text-red-500 dark:text-red-400">
                      Duplicate key
                    </span>
                  )}
                  {hasEmptyKeyError && (
                    <span className="absolute -bottom-4 left-0 text-[10px] text-red-500 dark:text-red-400">
                      Key required
                    </span>
                  )}
                </div>

                {/* Value Input */}
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                  readOnly={readOnly}
                  placeholder={showPlaceholders ? 'e.g. {BASENAME} SVG Bundle' : 'Value'}
                  className={`w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white ${
                    readOnly ? 'cursor-default bg-gray-50 dark:bg-gray-800' : ''
                  }`}
                />

                {/* Delete Button */}
                {!readOnly && (
                  <button
                    onClick={() => removeRow(row.id)}
                    className="flex h-8 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors"
                    title="Remove variable"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}

          {/* Validation Summary */}
          {duplicateKeys.size > 0 && (
            <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              ⚠️ Duplicate keys detected: {Array.from(duplicateKeys).join(', ')}. Only the last value will be used.
            </div>
          )}
        </div>
      )}

      {/* Footer Info */}
      {rows.length > 0 && !readOnly && (
        <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            These variables will be injected into <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">listing-info.txt</code> for each output.
          </p>
          {rows.length >= maxRows && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Maximum {maxRows} variables reached
            </span>
          )}
        </div>
      )}
    </div>
  );
}