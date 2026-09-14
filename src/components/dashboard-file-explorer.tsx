'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';

import { DEFAULT_STATUS_COLORS } from '@/lib/status-colors';
import { formatBytes, formatDate } from '@/lib/utils';

type ViewMode = 'LARGE_IMAGE' | 'THUMBNAIL' | 'LIST' | 'DETAILS';

interface ExplorerItem {
  id: string;
  batchId: string | null;
  itemId: string | null;
  artworkId: string | null;
  workingAssetId: string | null;
  originalFilename: string;
  baseName: string;
  extension: string;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  status: string;
  progress: number;
  currentStep: string | null;
  error: string | null;
  workingPath: string | null;
  workingDirectory: string | null;
  previewUrl: string;
  originalPreviewUrl: string;
  categories: Array<{ id: string; categoryId: string; name: string }>;
  createdAt: string;
  updatedAt: string;
  artworkFirst?: boolean;
}

interface Category {
  id: string;
  categoryId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  _count: { children: number; itemMemberships: number; relationshipMemberships: number };
}

interface ItemDetail {
  manifest?: Record<string, unknown>;
  manifestPath?: string;
  history?: Record<string, unknown>;
}

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: 'LARGE_IMAGE', label: 'Large' },
  { value: 'THUMBNAIL', label: 'Thumbnails' },
  { value: 'LIST', label: 'List' },
  { value: 'DETAILS', label: 'Details' },
];

const UNASSIGNED_CATEGORY_ID = '__unassigned__';

function categoryDescendants(categories: Category[], roots: Set<string>) {
  const result = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentId && result.has(category.parentId) && !result.has(category.id)) {
        result.add(category.id);
        changed = true;
      }
    }
  }
  return result;
}

export default function DashboardFileExplorer({ scope = 'workspace' }: { scope?: 'workspace' | 'ready' }) {
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [storage, setStorage] = useState<{
    processing: string;
    locations?: Array<{ id: string; name: string; rootPath: string; basePath: string; isDefaultImport: boolean; isReadOnly: boolean }>;
  } | null>(null);
  const [statusColors, setStatusColors] = useState<Record<string, string>>(DEFAULT_STATUS_COLORS);
  const [viewMode, setViewMode] = useState<ViewMode>('THUMBNAIL');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [fileType, setFileType] = useState('ALL');
  const [sortBy, setSortBy] = useState('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(new Set());
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextItem, setContextItem] = useState<ExplorerItem | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [manifest, setManifest] = useState<unknown>(null);
  const [previewItem, setPreviewItem] = useState<ExplorerItem | null>(null);
  const [splitItem, setSplitItem] = useState<ExplorerItem | null>(null);
  const [splitNames, setSplitNames] = useState<string[]>(['', '']);
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [renameTargets, setRenameTargets] = useState<ExplorerItem[]>([]);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [hover, setHover] = useState<{ item: ExplorerItem; x: number; y: number } | null>(null);
  const [details, setDetails] = useState<Record<string, ItemDetail>>({});
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<Set<string>>(new Set());
  const [assignmentExpandedCategoryIds, setAssignmentExpandedCategoryIds] = useState<Set<string>>(new Set());
  const [moveModal, setMoveModal] = useState(false);
  const [destinationRootPath, setDestinationRootPath] = useState('');
  const [makeDestinationDefault, setMakeDestinationDefault] = useState(false);
  const [moving, setMoving] = useState(false);
  const [internalArtworkDrag, setInternalArtworkDrag] = useState(false);
  const [categoryAssignmentInProgress, setCategoryAssignmentInProgress] = useState(false);
  const preferencesLoaded = useRef(false);
  const categoryExpandTimer = useRef<number | null>(null);
  const selectedRef = useRef<Set<string>>(new Set());
  const renameTarget = renameTargets[0] ?? null;

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const clearDragState = () => {
      setInternalArtworkDrag(false);
      clearCategoryExpandTimer();
    };
    window.addEventListener('dragend', clearDragState, true);
    window.addEventListener('drop', clearDragState, true);
    window.addEventListener('blur', clearDragState);
    return () => {
      window.removeEventListener('dragend', clearDragState, true);
      window.removeEventListener('drop', clearDragState, true);
      window.removeEventListener('blur', clearDragState);
    };
  }, []);

  const loadFiles = useCallback(async () => {
    const response = await fetch(`/api/dashboard/files?scope=${scope}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load artwork');
    setItems(data.items);
    setStorage(data.storage);
    setStatusColors(data.statusColors || DEFAULT_STATUS_COLORS);
  }, [scope]);

  const loadCategories = useCallback(async () => {
    const response = await fetch('/api/categories', { cache: 'no-store' });
    const data = await response.json();
    if (data.success) setCategories(data.categories);
  }, []);

  const scanInbox = useCallback(async () => {
    try {
      const response = await fetch('/api/ingest/scan', { method: 'POST' });
      const data = await response.json();
      if (data.success && data.imported > 0) {
        setNotice(`Imported ${data.imported} file${data.imported === 1 ? '' : 's'} from the processing folder.`);
        await loadFiles();
      }
    } catch { /* Files left in the inbox are retried by the next scan. */ }
  }, [loadFiles]);

  useEffect(() => {
    async function initialize() {
      try {
        const [preferenceResponse] = await Promise.all([
          fetch('/api/dashboard/preferences', { cache: 'no-store' }),
          loadFiles(), loadCategories(),
        ]);
        const data = await preferenceResponse.json();
        if (data.success && data.preference) {
          setViewMode(data.preference.viewMode || 'THUMBNAIL');
          const filters = data.preference.filters || {};
          setSearch(typeof filters.search === 'string' ? filters.search : '');
          setStatus(typeof filters.status === 'string' ? filters.status : 'ALL');
          setFileType(typeof filters.fileType === 'string' ? filters.fileType : 'ALL');
          setSelectedCategoryIds(new Set(Array.isArray(data.preference.selectedCategoryIds) ? data.preference.selectedCategoryIds : []));
          setExpandedCategoryIds(new Set(Array.isArray(data.preference.expandedCategoryIds) ? data.preference.expandedCategoryIds : []));
          setIncludeDescendants(data.preference.includeDescendants !== false);
          const sorting = Array.isArray(data.preference.sorting) ? data.preference.sorting : [];
          setSortBy(typeof sorting[0]?.field === 'string' ? sorting[0].field : 'name');
        }
        preferencesLoaded.current = true;
        await scanInbox();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Unable to initialize dashboard');
      }
    }
    initialize();
  }, [loadCategories, loadFiles, scanInbox]);

  useEffect(() => {
    const timer = window.setInterval(scanInbox, 5000);
    return () => window.clearInterval(timer);
  }, [scanInbox]);

  useEffect(() => {
    if (!preferencesLoaded.current) return;
    const timer = window.setTimeout(() => {
      fetch('/api/dashboard/preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewMode,
          expandedCategoryIds: [...expandedCategoryIds],
          selectedCategoryIds: [...selectedCategoryIds],
          includeDescendants,
          filters: { search, status, fileType },
          sorting: [{ field: sortBy, direction: 'asc' }],
        }),
      }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [expandedCategoryIds, fileType, includeDescendants, search, selectedCategoryIds, sortBy, status, viewMode]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      const response = await fetch('/api/ingest', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Import failed');
      setNotice(`Copied and imported ${data.files.length} file${data.files.length === 1 ? '' : 's'}.`);
      await loadFiles();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Import failed'); }
    finally { setUploading(false); }
  }, [loadFiles]);

  const { getInputProps, open } = useDropzone({
    onDrop: uploadFiles, noClick: true, noKeyboard: true, noDrag: true, maxFiles: 50, maxSize: 50 * 1024 * 1024,
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'], 'image/tiff': ['.tif', '.tiff'], 'image/svg+xml': ['.svg'] },
  });

  const hasUnassignedFilter = selectedCategoryIds.has(UNASSIGNED_CATEGORY_ID);
  const realSelectedCategoryIds = new Set([...selectedCategoryIds].filter((id) => id !== UNASSIGNED_CATEGORY_ID));
  const effectiveCategoryIds = includeDescendants
    ? categoryDescendants(categories, realSelectedCategoryIds)
    : realSelectedCategoryIds;
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items
      .filter((item) => status === 'ALL' || item.status === status)
      .filter((item) => fileType === 'ALL' || item.extension === fileType)
      .filter((item) => {
        if (!hasUnassignedFilter && effectiveCategoryIds.size === 0) return true;
        return (hasUnassignedFilter && item.categories.length === 0)
          || item.categories.some((category) => effectiveCategoryIds.has(category.id));
      })
      .filter((item) => !query || [item.originalFilename, item.baseName, item.artworkId, ...item.categories.map((category) => category.name)].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query)))
      .sort((a, b) => {
        if (sortBy === 'status') return a.status.localeCompare(b.status);
        if (sortBy === 'type') return a.extension.localeCompare(b.extension);
        if (sortBy === 'date') return b.updatedAt.localeCompare(a.updatedAt);
        if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
        return a.originalFilename.localeCompare(b.originalFilename, undefined, { numeric: true });
      });
  }, [effectiveCategoryIds, fileType, hasUnassignedFilter, items, search, sortBy, status]);

  const fileTypes = [...new Set(items.map((item) => item.extension).filter(Boolean))].sort();
  const statuses = [...new Set(items.map((item) => item.status))].sort();

  function toggleSelected(itemId: string, checked?: boolean) {
    const next = new Set(selectedRef.current);
    const shouldSelect = checked ?? !next.has(itemId);
    if (shouldSelect) next.add(itemId); else next.delete(itemId);
    selectedRef.current = next;
    setSelected(next);
  }

  function showContextMenu(event: React.MouseEvent, item: ExplorerItem) {
    event.preventDefault();
    if (!selectedRef.current.has(item.id)) {
      const next = new Set([item.id]);
      selectedRef.current = next;
      setSelected(next);
      setSelectionAnchorId(item.id);
    }
    setContextItem(item);
    setMenuPosition({ x: event.clientX, y: event.clientY });
  }

  async function loadItemDetail(item: ExplorerItem) {
    if (details[item.id]) return;
    const response = await fetch(`/api/dashboard/files/${item.id}/actions`, { cache: 'no-store' });
    const data = await response.json();
    if (data.success) setDetails((current) => ({ ...current, [item.id]: data }));
  }

  function showHover(event: React.MouseEvent, item: ExplorerItem) {
    setHover({ item, x: event.clientX, y: event.clientY });
    void loadItemDetail(item);
  }

  async function openWorkingFolder(item: ExplorerItem) {
    await fetch(`/api/dashboard/files/${item.id}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'open-folder' }) });
    setContextItem(null);
  }

  async function displayManifest(item: ExplorerItem) {
    const response = await fetch(`/api/dashboard/files/${item.id}/actions`, { cache: 'no-store' });
    const data = await response.json();
    if (data.success) setManifest(data.manifest); else setNotice(data.error || 'Manifest unavailable');
    setContextItem(null);
  }

  async function renameItem(item: ExplorerItem) {
    const targets = selected.has(item.id)
      ? visibleItems.filter((candidate) => selected.has(candidate.id))
      : [item];
    setRenameTargets(targets);
    setRenameValue(targets.length === 1 ? item.baseName : '');
    setRenameError(null);
    setContextItem(null);
  }
  async function submitRename() {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return setRenameError('Enter a new base filename.');
    if (renameTargets.length === 1 && name.toLocaleLowerCase() === renameTarget.baseName.toLocaleLowerCase()) return setRenameError('Enter a different name, or choose Cancel.');
    setRenaming(true); setRenameError(null);
    try {
      const response = renameTargets.length === 1
        ? await fetch(`/api/dashboard/files/${renameTarget.id}/actions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rename', baseName: name }),
          })
        : await fetch('/api/dashboard/files/batch-rename', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artworkIds: renameTargets.map((item) => item.id), baseName: name }),
          });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Rename failed');
      if (renameTargets.length === 1) {
        setNotice(`Renamed ${renameTarget.originalFilename}.`);
      } else {
        const renamed = data.result.renamed.length;
        const skipped = data.result.skipped.length;
        const failed = data.result.failures.length;
        setNotice(`Renamed ${renamed} artwork file${renamed === 1 ? '' : 's'}; ${skipped} already-numbered file${skipped === 1 ? '' : 's'} left unchanged${failed ? `; ${failed} failed` : ''}.`);
      }
      setRenameTargets([]);
      await loadFiles();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Rename failed');
    } finally { setRenaming(false); }
  }

  async function createCategory(parentId: string | null) {
    const name = window.prompt(parentId ? 'Subcategory name' : 'Category name');
    if (!name) return;
    const response = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId }) });
    const data = await response.json();
    if (!response.ok || !data.success) setNotice(data.error || 'Unable to create category');
    else { if (parentId) setExpandedCategoryIds((current) => new Set(current).add(parentId)); await loadCategories(); }
  }

  function openCategoryAssignment() {
    const selectedItems = items.filter((item) => selected.has(item.id));
    const common = new Set(selectedItems[0]?.categories.map((category) => category.id) ?? []);
    for (const item of selectedItems.slice(1)) {
      const ids = new Set(item.categories.map((category) => category.id));
      for (const id of common) if (!ids.has(id)) common.delete(id);
    }
    setCategoryDraft(common);
    setAssignmentExpandedCategoryIds(new Set(categories.filter((category) => category._count.children > 0).map((category) => category.id)));
    setCategoryModal(true);
  }

  async function saveCategoryAssignment() {
    try {
      const response = await fetch('/api/categories/assign', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: items.filter((item) => selected.has(item.id)).map((item) => item.itemId).filter((value): value is string => Boolean(value)),
          categoryIds: [...categoryDraft],
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to assign categories');
      setNotice(`Updated categories for ${selected.size} file${selected.size === 1 ? '' : 's'}.`);
      setCategoryModal(false);
      await Promise.all([loadFiles(), loadCategories()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to assign categories');
    }
  }

  async function moveSelectedArtwork() {
    if (selected.size === 0 || !destinationRootPath.trim()) return;
    setMoving(true);
    try {
      const response = await fetch('/api/dashboard/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchItemIds: [...selected],
          destinationRootPath: destinationRootPath.trim(),
          makeDefaultImport: makeDestinationDefault,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to move artwork');
      if (data.failed) {
        setNotice(`Moved ${data.moved}; ${data.failed} failed. ${data.error || ''}`);
      } else {
        setNotice(`Moved ${data.moved} artwork director${data.moved === 1 ? 'y' : 'ies'} and updated the database.`);
        setMoveModal(false);
        setSelected(new Set());
      }
      await loadFiles();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to move artwork');
    } finally {
      setMoving(false);
    }
  }

  async function deleteSelectedArtwork(explicitItems?: ExplorerItem[]) {
    const selectedItems = explicitItems ?? items.filter((item) => selected.has(item.id));
    if (selectedItems.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedItems.length} selected artwork file${selectedItems.length === 1 ? '' : 's'}?\n\nArtwork is moved to recoverable storage.`
    );
    if (!confirmed) return;
    let deleted = 0;
    const failures: string[] = [];
    for (const item of selectedItems) {
      try {
        const response = await fetch(`/api/dashboard/files/${item.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete-artwork' }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Delete failed');
        deleted += 1;
      } catch (error) {
        failures.push(`${item.originalFilename}: ${error instanceof Error ? error.message : 'Delete failed'}`);
      }
    }
    setSelected(new Set());
    setContextItem(null);
    setNotice(failures.length ? `Deleted ${deleted}; ${failures.length} blocked or failed. ${failures.join('; ')}` : `Deleted ${deleted} artwork file${deleted === 1 ? '' : 's'}.`);
    await Promise.all([loadFiles(), loadCategories()]);
  }

  async function deleteCategory(category: Category) {
    const confirmed = window.confirm(
      `Delete category "${category.name}"${category._count.children ? ' and all of its subcategories' : ''}?\n\nCategory assignments will be removed. Artwork files will not be deleted.`
    );
    if (!confirmed) return;
    try {
      const response = await fetch('/api/categories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: category.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to delete category');
      setSelectedCategoryIds((current) => {
        const next = new Set(current);
        next.delete(category.id);
        return next;
      });
      setNotice(`Deleted ${data.result.deletedCategories} categor${data.result.deletedCategories === 1 ? 'y' : 'ies'}; artwork was not deleted.`);
      await Promise.all([loadCategories(), loadFiles()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to delete category');
    }
  }

  async function moveCategoryToParent(categoryId: string, newParentId: string) {
    const response = await fetch('/api/categories', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoryId, newParentId }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to move category');
    await loadCategories();
  }

  function draggedArtworkItemIds(event: React.DragEvent) {
    try {
      const value = event.dataTransfer.getData('application/x-vectorforge-artwork-items');
      const ids = JSON.parse(value);
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  }

  function isSupportedCategoryDrop(event: React.DragEvent) {
    const types = Array.from(event.dataTransfer.types);
    return types.includes('application/x-vectorforge-category') || types.includes('application/x-vectorforge-artwork-items');
  }

  function clearCategoryExpandTimer() {
    if (categoryExpandTimer.current !== null) window.clearTimeout(categoryExpandTimer.current);
    categoryExpandTimer.current = null;
  }

  function handleCategoryDragOver(event: React.DragEvent, category: Category, setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>) {
    if (!isSupportedCategoryDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const isArtworkDrag = Array.from(event.dataTransfer.types).includes('application/x-vectorforge-artwork-items');
    if (isArtworkDrag && category._count.children > 0 && categoryExpandTimer.current === null) {
      categoryExpandTimer.current = window.setTimeout(() => {
        setExpanded((current) => new Set(current).add(category.id));
        categoryExpandTimer.current = null;
      }, 1100);
    }
  }

  async function handleCategoryDrop(event: React.DragEvent, category: Category, setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>) {
    clearCategoryExpandTimer();
    if (!isSupportedCategoryDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const movedId = event.dataTransfer.getData('application/x-vectorforge-category');
    if (movedId) {
      if (movedId === category.id) return;
      try { await moveCategoryToParent(movedId, category.id); setExpanded((current) => new Set(current).add(category.id)); setNotice('Category moved.'); }
      catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to move category'); }
      return;
    }
    const itemIds = draggedArtworkItemIds(event);
    if (!itemIds.length) return;
    setCategoryAssignmentInProgress(true);
    setNotice(`Assigning ${itemIds.length} artwork file${itemIds.length === 1 ? '' : 's'} to ${category.name}…`);
    try {
      const response = await fetch('/api/categories/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds, categoryId: category.id }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to assign category');
      setNotice(`Assigned ${data.updated} artwork file${data.updated === 1 ? '' : 's'} to ${category.name}.`);
      await Promise.all([loadFiles(), loadCategories()]);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to assign category'); }
    finally {
      setCategoryAssignmentInProgress(false);
      setInternalArtworkDrag(false);
    }
  }

  function renderCategory(parentId: string | null, depth = 0): React.ReactNode {
    return categories.filter((category) => category.parentId === parentId).map((category) => {
      const expanded = expandedCategoryIds.has(category.id);
      return (
        <div key={category.id}>
          <div draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-vectorforge-category', category.id); }} onDragOver={(event) => handleCategoryDragOver(event, category, setExpandedCategoryIds)} onDragLeave={clearCategoryExpandTimer} onDrop={(event) => void handleCategoryDrop(event, category, setExpandedCategoryIds)} className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-gray-100 dark:hover:bg-gray-700" style={{ paddingLeft: depth * 14 }}>
            <button type="button" className="w-5 text-xs" onClick={() => setExpandedCategoryIds((current) => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })}>{category._count.children ? (expanded ? '▾' : '▸') : ''}</button>
            <input type="checkbox" checked={selectedCategoryIds.has(category.id)} onChange={() => setSelectedCategoryIds((current) => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })} />
            <span className="min-w-0 flex-1 truncate text-sm" title={category.name}>{category.name}</span>
            <span className="text-xs text-gray-400">{category._count.itemMemberships}</span>
            <button type="button" title="Add subcategory" onClick={() => createCategory(category.id)} className="invisible px-1 font-bold text-blue-600 group-hover:visible">+</button>
            <button type="button" title="Delete category" onClick={() => deleteCategory(category)} className="invisible px-1 font-bold text-red-600 group-hover:visible">×</button>
          </div>
          {expanded && renderCategory(category.id, depth + 1)}
        </div>
      );
    });
  }

  function renderAssignmentCategory(parentId: string | null, depth = 0): React.ReactNode {
    return categories.filter((category) => category.parentId === parentId).map((category) => {
      const expanded = assignmentExpandedCategoryIds.has(category.id);
      return (
        <div key={category.id}>
          <div
            draggable
            onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-vectorforge-category', category.id); }}
            onDragOver={(event) => handleCategoryDragOver(event, category, setAssignmentExpandedCategoryIds)}
            onDragLeave={clearCategoryExpandTimer}
            onDrop={(event) => void handleCategoryDrop(event, category, setAssignmentExpandedCategoryIds)}
            className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-gray-100 dark:hover:bg-gray-700"
            style={{ paddingLeft: depth * 14 }}
          >
            <button type="button" className="w-5 text-xs" onClick={() => setAssignmentExpandedCategoryIds((current) => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })}>{category._count.children ? (expanded ? '▾' : '▸') : ''}</button>
            <input type="checkbox" checked={categoryDraft.has(category.id)} onChange={() => setCategoryDraft((current) => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })} />
            <span className="min-w-0 flex-1 truncate text-sm" title={category.name}>{category.name}</span>
            <button type="button" title="Add subcategory" onClick={() => createCategory(category.id).then(() => setAssignmentExpandedCategoryIds((current) => new Set(current).add(category.id)))} className="invisible px-1 font-bold text-blue-600 group-hover:visible">+</button>
          </div>
          {expanded && renderAssignmentCategory(category.id, depth + 1)}
        </div>
      );
    });
  }

  const interactionProps = (item: ExplorerItem) => ({
    onContextMenu: (event: React.MouseEvent) => showContextMenu(event, item),
    onMouseDown: (event: React.MouseEvent) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('input, [data-explorer-action]'))) return;
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && selectedRef.current.has(item.id) && selectedRef.current.size > 1) return;
      selectArtwork(item, event);
    },
    onClick: (event: React.MouseEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || (event.target instanceof Element && event.target.closest('input, [data-explorer-action]'))) return;
      if (selectedRef.current.has(item.id) && selectedRef.current.size > 1) selectArtwork(item, event);
    },
    onMouseEnter: (event: React.MouseEvent) => showHover(event, item),
    onMouseMove: (event: React.MouseEvent) => setHover({ item, x: event.clientX, y: event.clientY }),
    onMouseLeave: () => setHover(null),
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.stopPropagation();
      setInternalArtworkDrag(true);
      const currentSelection = selectedRef.current;
      const dragged = currentSelection.has(item.id) ? items.filter((candidate) => currentSelection.has(candidate.id)) : [item];
      const itemIds = dragged.map((candidate) => candidate.itemId).filter((id): id is string => Boolean(id));
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-vectorforge-artwork-items', JSON.stringify(itemIds));
      event.dataTransfer.setData('text/plain', dragged.map((candidate) => candidate.originalFilename).join(', '));
    },
    onDragEnd: () => {
      setInternalArtworkDrag(false);
      clearCategoryExpandTimer();
    },
  });

  function selectArtwork(item: ExplorerItem, event?: React.MouseEvent) {
    const index = visibleItems.findIndex((candidate) => candidate.id === item.id);
    const current = selectedRef.current;
    let next: Set<string>;
    if (event?.shiftKey && selectionAnchorId) {
      const anchor = visibleItems.findIndex((candidate) => candidate.id === selectionAnchorId);
      if (anchor >= 0 && index >= 0) {
        next = new Set(visibleItems.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((candidate) => candidate.id));
      } else {
        next = new Set([item.id]);
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      next = new Set(current);
      next.has(item.id) ? next.delete(item.id) : next.add(item.id);
      setSelectionAnchorId(item.id);
    } else {
      next = new Set([item.id]);
      setSelectionAnchorId(item.id);
    }
    selectedRef.current = next;
    setSelected(next);
  }

  async function createSplitArtwork() {
    if (!splitItem) return;
    setSplitError(null);
    const childNames = splitNames.map((name) => name.trim());
    if (!childNames[0]) return setNotice('Artwork 1 must have a name.');
    setSplitting(true);
    try {
      const response = await fetch(`/api/dashboard/files/${splitItem.id}/split`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childNames }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to create extracted artwork');
      const created = data.result.files.length;
      const renamed = data.result.renamed ? ' Renamed Artwork 1.' : '';
      setNotice(`${created ? `Created ${created} independent artwork cop${created === 1 ? 'y' : 'ies'}.` : 'No additional copies were requested.'}${renamed} Open each created copy in the raster editor to crop its image.`);
      setSplitItem(null);
      await loadFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to split artwork';
      setSplitError(message);
      setNotice(message);
    } finally { setSplitting(false); }
  }

  const selectedItems = items.filter((item) => selected.has(item.id));
  const selectedIncludesArtworkFirst = selectedItems.some((item) => item.artworkFirst);

  return (
    <section className="relative rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <input {...getInputProps()} />
      <div className="space-y-3 border-b p-4 dark:border-gray-700">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{scope === 'ready' ? 'Completed Vector Artwork' : 'Artwork Files'}</h2><p className="mt-1 text-xs text-gray-500">{scope === 'ready' ? 'Approved vector artwork ready for use by other SEMA applications. Files remain in their managed VectorForge location.' : 'Working copies are shown here; originals remain protected.'}</p></div>{scope === 'workspace' && <div className="flex gap-2"><button type="button" onClick={open} disabled={uploading} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{uploading ? 'Importing…' : 'Open Files'}</button><button type="button" onClick={scanInbox} className="rounded-lg border px-3 py-2 text-sm font-semibold">Scan Folder</button></div>}</div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_minmax(150px,.7fr)_minmax(150px,.7fr)_minmax(160px,.7fr)_minmax(250px,1fr)]"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, ID, or category" className="min-w-0 rounded-md border px-3 py-2 text-sm dark:bg-gray-900" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="min-w-0 rounded-md border px-2 py-2 text-sm dark:bg-gray-900"><option value="ALL">All statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select><select value={fileType} onChange={(event) => setFileType(event.target.value)} className="min-w-0 rounded-md border px-2 py-2 text-sm dark:bg-gray-900"><option value="ALL">All file types</option>{fileTypes.map((value) => <option key={value}>{value}</option>)}</select><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="min-w-0 rounded-md border px-3 py-2 text-sm dark:bg-gray-900"><option value="name">Sort: Name</option><option value="type">Sort: Type</option><option value="status">Sort: Status</option><option value="date">Sort: Updated</option><option value="size">Sort: Size</option></select><div className="grid grid-cols-4 gap-1 rounded-md border p-1">{VIEW_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setViewMode(option.value)} className={`rounded px-2 py-1 text-xs ${viewMode === option.value ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : ''}`}>{option.label}</button>)}</div></div>
        {selected.size > 0 && <div className="flex flex-wrap items-center gap-2 rounded bg-blue-50 p-2 text-sm dark:bg-blue-950"><strong>{selected.size} selected</strong><button type="button" onClick={openCategoryAssignment} className="rounded bg-white px-3 py-1.5 font-semibold shadow">Categories</button><button type="button" onClick={() => renameItem(selectedItems[0])} className="rounded bg-white px-3 py-1.5 font-semibold shadow">Rename</button><button type="button" onClick={() => void deleteSelectedArtwork()} className="rounded bg-red-600 px-3 py-1.5 font-semibold text-white shadow">Delete</button><button type="button" onClick={() => setSelected(new Set())} className="rounded bg-white px-3 py-1.5 font-semibold shadow">Clear</button><button type="button" onClick={() => setSelected(new Set(visibleItems.map((item) => item.id)))} className="rounded bg-white px-3 py-1.5 font-semibold shadow">Select All Visible</button></div>}
      </div>
      <div className="flex h-[calc(100vh-11rem)] min-h-[580px] overflow-hidden">
        <aside className="flex w-72 shrink-0 flex-col border-r dark:border-gray-700">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">Categories</h3><button type="button" onClick={() => createCategory(null)} className="rounded px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50">+ New</button></div>
            <p className="mb-2 text-xs text-gray-500">Drag artwork here to assign it. Pause over a parent to open its children.</p>
            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-700"><input type="checkbox" checked={selectedCategoryIds.has(UNASSIGNED_CATEGORY_ID)} onChange={() => setSelectedCategoryIds((current) => { const next = new Set(current); if (next.has(UNASSIGNED_CATEGORY_ID)) next.delete(UNASSIGNED_CATEGORY_ID); else next.add(UNASSIGNED_CATEGORY_ID); return next; })} />Unassigned <span className="ml-auto text-xs font-normal text-gray-400">{items.filter((item) => item.categories.length === 0).length}</span></label>
            {categories.length ? renderCategory(null) : <p className="text-xs text-gray-500">No categories yet. Select “+ New” to build your tree.</p>}
            {selectedCategoryIds.size > 0 && <label className="mt-3 flex items-center gap-2 border-t pt-3 text-xs"><input type="checkbox" checked={includeDescendants} onChange={(event) => setIncludeDescendants(event.target.checked)} /> Include subcategories</label>}
          </div>
          {storage && <p className="truncate border-t px-3 py-2 text-xs text-gray-500" title={storage.processing}>Watched: {storage.processing}</p>}
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto" onClick={(event) => { if (event.target === event.currentTarget) { selectedRef.current = new Set(); setSelected(new Set()); setSelectionAnchorId(null); } }}>
          {notice && <div className="m-3 flex justify-between rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} className="font-bold">×</button></div>}
          {visibleItems.length === 0 ? <div className="p-12 text-center text-sm text-gray-500">No files match the current filters.</div> : viewMode === 'DETAILS' ? (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900"><tr><th className="px-3 py-3"></th><th className="px-3 py-3">Name</th><th className="px-3 py-3">Size</th><th className="px-3 py-3">Created</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Status</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} {...interactionProps(item)} className={`cursor-pointer border-t hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700 ${selected.has(item.id) ? 'bg-blue-50 dark:bg-blue-950' : ''}`}><td className="px-3"><input type="checkbox" checked={selected.has(item.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelected(item.id, event.target.checked)} /></td><td className="px-3 py-3 font-bold" style={{ color: statusColors[item.status] }}><span className="font-bold">{item.originalFilename}</span></td><td className="px-3 py-3">{formatBytes(item.size || 0)}</td><td className="px-3 py-3">{formatDate(item.createdAt)}</td><td className="px-3 py-3">{item.extension}</td><td className="px-3 py-3 font-semibold">{item.status.replaceAll('_', ' ')}</td></tr>)}</tbody></table></div>
          ) : viewMode === 'LIST' ? (
            <div className="divide-y dark:divide-gray-700">{visibleItems.map((item) => <div key={item.id} {...interactionProps(item)} className={`flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 ${selected.has(item.id) ? 'bg-blue-50 dark:bg-blue-950' : ''}`}><input type="checkbox" checked={selected.has(item.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelected(item.id, event.target.checked)} /><span className="flex-1 text-left text-sm font-bold" style={{ color: statusColors[item.status] }}>{item.originalFilename}</span></div>)}</div>
          ) : (
            <div className={`grid gap-4 p-4 ${viewMode === 'LARGE_IMAGE' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5'}`}>
              {visibleItems.map((item) => <div key={item.id} {...interactionProps(item)} className={`group relative cursor-pointer overflow-hidden rounded-lg border-4 bg-white shadow-sm hover:shadow-md dark:bg-gray-900 ${selected.has(item.id) ? 'ring-4 ring-blue-500 ring-offset-2 dark:ring-offset-gray-800' : ''}`} style={{ borderColor: statusColors[item.status] || DEFAULT_STATUS_COLORS.PENDING }}><input type="checkbox" checked={selected.has(item.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelected(item.id, event.target.checked)} className="absolute left-2 top-2 z-10 h-5 w-5" /><div className={`flex items-center justify-center bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:20px_20px] ${viewMode === 'LARGE_IMAGE' ? 'h-64' : 'h-36'}`}><img draggable={false} src={item.previewUrl} alt={`${item.originalFilename} working copy`} className="max-h-full max-w-full object-contain" /></div><div className="p-3"><p className="truncate text-sm font-bold">{item.originalFilename}</p>{viewMode === 'LARGE_IMAGE' && <p className="mt-1 text-xs text-gray-500">{formatBytes(item.size || 0)} · {item.status.replaceAll('_', ' ')}</p>}</div>{viewMode === 'LARGE_IMAGE' && <button type="button" data-explorer-action onClick={(event) => { event.stopPropagation(); renameItem(item); }} className="absolute right-2 top-2 rounded bg-white/95 px-2 py-1 text-xs font-bold opacity-0 shadow group-hover:opacity-100">Rename</button>}</div>)}
            </div>
          )}

        </div>
      </div>

      {hover && <div className="pointer-events-none fixed z-50 w-80 rounded-xl border bg-white p-4 shadow-2xl dark:border-gray-600 dark:bg-gray-800" style={{ left: Math.min(hover.x + 18, window.innerWidth - 340), top: Math.min(hover.y + 18, window.innerHeight - 390) }}><div className="flex gap-3"><img src={hover.item.originalPreviewUrl} alt="Untouched original" className="h-24 w-24 rounded border bg-gray-100 object-contain" /><div className="min-w-0"><p className="truncate font-bold">{hover.item.originalFilename}</p><p className="text-xs text-gray-500">Original thumbnail</p><p className="mt-2 text-xs font-semibold" style={{ color: statusColors[hover.item.status] }}>{hover.item.status.replaceAll('_', ' ')}</p></div></div><dl className="mt-3 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-xs"><dt className="font-semibold">Artwork ID</dt><dd className="truncate">{hover.item.artworkId || '—'}</dd><dt className="font-semibold">Working copy</dt><dd>Shown on dashboard</dd><dt className="font-semibold">Dimensions</dt><dd>{hover.item.width && hover.item.height ? `${hover.item.width} × ${hover.item.height}` : '—'}</dd><dt className="font-semibold">Size / type</dt><dd>{formatBytes(hover.item.size || 0)} · {hover.item.extension}</dd><dt className="font-semibold">Categories</dt><dd>{hover.item.categories.map((category) => category.name).join(', ') || 'Uncategorized'}</dd><dt className="font-semibold">History</dt><dd>{hover.item.currentStep || `${hover.item.progress}% complete`}</dd><dt className="font-semibold">Manifest</dt><dd>{details[hover.item.id]?.manifest ? String((details[hover.item.id].manifest as Record<string, unknown>).manifestType || 'Available') : 'Loading…'}</dd><dt className="font-semibold">Updated</dt><dd>{formatDate(hover.item.updatedAt)}</dd></dl>{hover.item.error && <p className="mt-2 text-xs text-red-600">{hover.item.error}</p>}</div>}

      <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="fixed bottom-6 right-6 z-40 rounded-full bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-blue-700" title="Return to the dashboard controls at the top">↑ Top</button>

      {contextItem && (
        <div className="fixed z-50 min-w-52 rounded-lg border bg-white py-1 shadow-xl dark:bg-gray-800" style={{ left: menuPosition.x, top: menuPosition.y }} onMouseLeave={() => setContextItem(null)}>
          {contextItem.artworkFirst ? <><button type="button" onClick={() => { setPreviewItem(contextItem); setContextItem(null); }} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">View working artwork</button><Link href={`/artwork/${contextItem.id}`} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Open Preview / Tune…</Link><button type="button" onClick={() => { setSplitNames([contextItem.originalFilename, '']); setSplitError(null); setSplitItem(contextItem); setContextItem(null); }} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Create artwork copies…</button><button type="button" onClick={() => renameItem(contextItem)} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">{selected.has(contextItem.id) && selected.size > 1 ? `Rename selected (${selected.size})…` : 'Rename…'}</button></> : <><Link href={`/upload/review/${contextItem.batchId}?itemId=${contextItem.id}`} className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700">Open to process</Link><Link href={`/upload/review/${contextItem.batchId}?itemId=${contextItem.id}&openRaster=1`} className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700">Open in raster editor…</Link><button type="button" onClick={() => { setSplitNames([contextItem.originalFilename, '']); setSplitError(null); setSplitItem(contextItem); setContextItem(null); }} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Create artwork copies…</button><button type="button" onClick={() => renameItem(contextItem)} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Rename…</button></>}
          <button type="button" onClick={openCategoryAssignment} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Assign categories ({selected.size})</button>
          {!contextItem.artworkFirst && <button type="button" onClick={() => { setContextItem(null); setMoveModal(true); }} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Move selected ({selected.size})…</button>}
          <button type="button" onClick={() => openWorkingFolder(contextItem)} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Open working folder</button>
          <button type="button" onClick={() => displayManifest(contextItem)} className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Display manifest</button>
          <button type="button" onClick={() => void deleteSelectedArtwork([contextItem])} className="block w-full px-4 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50">Delete artwork…</button>
        </div>
      )}

      {manifest !== null && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setManifest(null)}><div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex justify-between"><h3 className="font-semibold">Artwork Manifest</h3><button type="button" onClick={() => setManifest(null)}>Close</button></div><pre className="overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-green-100">{JSON.stringify(manifest, null, 2)}</pre></div></div>}

      {previewItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setPreviewItem(null)}><div className="w-full max-w-4xl rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}><div className="mb-4 flex items-start justify-between"><div><h3 className="font-bold">{previewItem.originalFilename}</h3><p className="text-sm text-gray-500">Working copy · {previewItem.width && previewItem.height ? `${previewItem.width} × ${previewItem.height} px` : 'Dimensions unavailable'} · {formatBytes(previewItem.size || 0)}</p></div><button type="button" onClick={() => setPreviewItem(null)}>Close</button></div><div className="flex max-h-[60vh] items-center justify-center rounded-lg bg-gray-100 p-3 dark:bg-gray-950"><img src={previewItem.previewUrl} alt={`${previewItem.originalFilename} working copy`} className="max-h-[56vh] max-w-full object-contain" /></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPreviewItem(null)} className="rounded border px-3 py-2">Cancel</button>{previewItem.artworkFirst ? <Link href={`/artwork/${previewItem.id}`} className="rounded bg-blue-600 px-3 py-2 font-semibold text-white">Open Preview / Tune</Link> : <><Link href={`/upload/review/${previewItem.batchId}?itemId=${previewItem.id}&openRaster=1`} className="rounded border px-3 py-2 font-semibold">Prepare Working Raster</Link><Link href={`/upload/review/${previewItem.batchId}?itemId=${previewItem.id}`} className="rounded bg-blue-600 px-3 py-2 font-semibold text-white">Open to Process</Link></>}</div></div></div>}

      {splitItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800"><div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(360px,1fr)]"><div><h3 className="font-bold">Create artwork copies</h3><p className="mt-1 text-sm text-gray-500">The preview is the source artwork. Artwork 1 remains this artwork; change its name only when you want to rename it. Artwork 2 and later become independent copies.</p><div className="mt-4 flex min-h-[340px] items-center justify-center rounded-lg border bg-gray-100 p-4 dark:bg-gray-950"><img src={splitItem.previewUrl} alt={`${splitItem.originalFilename} working artwork`} className="max-h-[56vh] max-w-full object-contain" /></div><p className="mt-2 text-xs text-gray-500">{splitItem.width && splitItem.height ? `${splitItem.width.toLocaleString()} × ${splitItem.height.toLocaleString()} px` : 'Dimensions unavailable'} · {formatBytes(splitItem.size || 0)}</p></div><div><h3 className="font-bold">Artwork names</h3>{splitError && <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">{splitError}</p>}<div className="mt-4 space-y-2">{splitNames.map((name, index) => <div key={index} className="flex gap-2"><input value={name} onChange={(event) => setSplitNames((current) => current.map((value, position) => position === index ? event.target.value : value))} placeholder={`Artwork ${index + 1} name`} title={index === 0 ? 'This is the existing artwork. Change the name only to rename it.' : 'This creates a new independent artwork copy from the original image.'} className="min-w-0 flex-1 rounded border px-3 py-2" />{index > 0 && <button type="button" title="Remove this additional artwork entry" onClick={() => setSplitNames((current) => current.filter((_, position) => position !== index))} className="rounded border px-3">Remove</button>}</div>)}</div><button type="button" title="Add another independent artwork copy" onClick={() => setSplitNames((current) => [...current, ''])} disabled={splitNames.length >= 24} className="mt-3 rounded border px-3 py-2 text-sm font-semibold">Add image</button><p className="mt-3 text-xs text-gray-500">Additional artwork is copied from the immutable original. Duplicate names receive permanent suffixes such as <strong>rose-0001</strong> and <strong>rose-0002</strong>.</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={splitting} onClick={() => setSplitItem(null)} className="rounded border px-3 py-2">Cancel</button><button type="button" disabled={splitting} onClick={createSplitArtwork} className="rounded bg-blue-600 px-3 py-2 font-semibold text-white">{splitting ? 'Creating…' : 'Create artwork copies'}</button></div></div></div></div></div>}
      {renameTarget && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"><h3 className="font-bold">{renameTargets.length === 1 ? 'Rename artwork' : `Rename ${renameTargets.length} selected artwork files`}</h3><p className="mt-1 text-sm text-gray-600">The extension is preserved. Associated working, original, output, manifest, and metadata filenames are updated; permanent IDs do not change.{renameTargets.length > 1 ? ' Selected artwork already named with this base and a four-digit suffix is left unchanged.' : ''}</p><label className="mt-4 block text-sm font-semibold">New base filename<input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>{renameError && <p className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{renameError}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={renaming} onClick={() => setRenameTargets([])} className="rounded border px-3 py-2">Cancel</button><button type="button" disabled={renaming} onClick={() => void submitRename()} className="rounded bg-blue-600 px-3 py-2 font-semibold text-white">{renaming ? 'Renaming…' : renameTargets.length === 1 ? 'Rename artwork' : 'Rename selected artwork'}</button></div></div></div>}

      {categoryModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"><div className="max-h-[80vh] w-full max-w-md overflow-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800"><div className="flex items-center justify-between"><h3 className="font-bold">Assign Categories</h3><button type="button" onClick={() => createCategory(null)} className="rounded px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50">+ New</button></div><p className="mt-1 text-xs text-gray-500">The checked set will be applied to all {selected.size} selected files. Drag a category onto another category to make it a subcategory.</p><div className="my-4 rounded border p-2">{categories.length ? renderAssignmentCategory(null) : <p className="p-2 text-sm text-gray-500">No categories yet. Use + New to create one.</p>}</div><div className="flex justify-end gap-2"><button type="button" onClick={() => setCategoryModal(false)} className="rounded border px-3 py-2">Cancel</button><button type="button" onClick={saveCategoryAssignment} className="rounded bg-blue-600 px-3 py-2 font-semibold text-white">Apply</button></div></div></div>}


      {moveModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"><div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800"><h3 className="font-bold">Move {selected.size} Selected Artwork Director{selected.size === 1 ? 'y' : 'ies'}</h3><p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Enter a local or synchronized storage root. For Google Drive, use the folder path created by Google Drive for desktop. VectorForge adds the current user’s profile directory beneath it.</p>{(storage?.locations?.length ?? 0) > 0 && <select value="" onChange={(event) => setDestinationRootPath(event.target.value)} className="mt-4 w-full rounded border px-3 py-2 text-sm dark:bg-gray-900"><option value="">Choose a registered Storage Location…</option>{storage!.locations!.filter((location) => !location.isReadOnly).map((location) => <option key={location.id} value={location.rootPath}>{location.name}{location.isDefaultImport ? ' (default)' : ''}</option>)}</select>}<input value={destinationRootPath} onChange={(event) => setDestinationRootPath(event.target.value)} placeholder={'G:\\My Drive\\VectorForge'} className="mt-3 w-full rounded border px-3 py-2 font-mono text-sm dark:bg-gray-900" /><label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={makeDestinationDefault} onChange={(event) => setMakeDestinationDefault(event.target.checked)} className="mt-1" /><span><strong>Use this as my default import Storage Location</strong><br /><span className="text-xs text-gray-500">Future imports for this user will be stored here.</span></span></label><p className="mt-4 rounded bg-amber-50 p-3 text-xs text-amber-900">Files are copied and database paths are updated before old files are removed.</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={moving} onClick={() => setMoveModal(false)} className="rounded border px-3 py-2">Cancel</button><button type="button" disabled={moving || !destinationRootPath.trim()} onClick={moveSelectedArtwork} className="rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{moving ? 'Moving…' : 'Move and Update Database'}</button></div></div></div>}
    </section>
  );
}
