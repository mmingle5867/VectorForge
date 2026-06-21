import type { ListingMetadata, ProcessingHistoryEntry } from '@/lib/package-manifest-schema';

export interface ListingMetadataCompleteness {
  percentage: number;
  completeFields: number;
  totalFields: number;
  missingFields: string[];
}

const REQUIRED_COMPLETENESS_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'description', label: 'Description' },
  { key: 'tags', label: 'Tags' },
  { key: 'category', label: 'Category' },
  { key: 'suggestedPrice', label: 'Suggested Price' },
] as const;

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseDelimitedList(value: string) {
  return value
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, array) => array.indexOf(entry) === index);
}

function readStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry, index, array) => array.indexOf(entry) === index);
  }

  if (typeof value === 'string') {
    return parseDelimitedList(value);
  }

  return [];
}

export function createEmptyListingMetadata(): ListingMetadata {
  return {
    title: '',
    shortTitle: '',
    description: '',
    shortDescription: '',
    bulletPoints: [],
    tags: [],
    keywords: [],
    category: '',
    subcategory: '',
    style: [],
    occasion: [],
    holiday: [],
    audience: [],
    suggestedPrice: null,
    currency: 'USD',
    notes: '',
  };
}

export function normalizeListingMetadata(value: unknown): ListingMetadata {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    title: readString(source.title),
    shortTitle: readString(source.shortTitle),
    description: readString(source.description),
    shortDescription: readString(source.shortDescription),
    bulletPoints: readStringArray(source.bulletPoints),
    tags: readStringArray(source.tags),
    keywords: readStringArray(source.keywords),
    category: readString(source.category),
    subcategory: readString(source.subcategory),
    style: readStringArray(source.style),
    occasion: readStringArray(source.occasion),
    holiday: readStringArray(source.holiday),
    audience: readStringArray(source.audience),
    suggestedPrice: readNumber(source.suggestedPrice),
    currency: readString(source.currency) || 'USD',
    notes: readString(source.notes),
  };
}

export function calculateListingMetadataCompleteness(listing: ListingMetadata): ListingMetadataCompleteness {
  const missingFields: string[] = [];

  for (const field of REQUIRED_COMPLETENESS_FIELDS) {
    switch (field.key) {
      case 'title':
        if (!listing.title.trim()) missingFields.push(field.label);
        break;
      case 'description':
        if (!listing.description.trim()) missingFields.push(field.label);
        break;
      case 'tags':
        if (!listing.tags.length) missingFields.push(field.label);
        break;
      case 'category':
        if (!listing.category.trim()) missingFields.push(field.label);
        break;
      case 'suggestedPrice':
        if (listing.suggestedPrice === null || listing.suggestedPrice === undefined) {
          missingFields.push(field.label);
        }
        break;
    }
  }

  const completeFields = REQUIRED_COMPLETENESS_FIELDS.length - missingFields.length;
  const percentage = Math.round((completeFields / REQUIRED_COMPLETENESS_FIELDS.length) * 100);

  return {
    percentage,
    completeFields,
    totalFields: REQUIRED_COMPLETENESS_FIELDS.length,
    missingFields,
  };
}

export function appendListingMetadataHistory(existing: ProcessingHistoryEntry[] | undefined) {
  const nextEntry: ProcessingHistoryEntry = {
    step: 'listing-metadata-updated',
    app: 'VectorForge',
    appVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    settings: {},
  };

  return [...(Array.isArray(existing) ? existing : []), nextEntry];
}
