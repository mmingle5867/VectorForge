import fs from 'fs/promises';
import path from 'path';
import { getLicensePath, getReadmePath } from '@/lib/output-naming';

export type TemplateValues = Record<string, string>;

export interface PackageDocumentSettings {
  companyName?: string | null;
  contactName?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  supportUrl?: string | null;
  defaultLicenseType?: string | null;
  templateVariables?: Record<string, string> | null;
  templatePath?: string | null;
}

export interface GeneratePackageDocumentsInput {
  outputDir: string;
  baseAssetsPath: string;
  productName: string;
  sku: string;
  artworkId?: string | null;
  profileId?: string | null;
  fileTypes: string[];
  profileType?: string | null;
  artworkTitle?: string | null;
  settings?: PackageDocumentSettings;
}

export const DEFAULT_README_TEMPLATE = `Thank you for your purchase.

Product:
{{PRODUCT_NAME}}

Artwork Title:
{{ARTWORK_TITLE}}

Artwork ID:
{{ARTWORK_ID}}

Profile ID:
{{PROFILE_ID}}

SKU:
{{SKU}}

Included File Types:
{{FILE_TYPES}}

Support:
{{COMPANY_NAME}}
{{CONTACT_NAME}}
{{EMAIL}}
{{PHONE}}
{{WEBSITE}}
{{SUPPORT_URL}}
{{ETSY_SHOP}}

Generated:
{{CURRENT_DATE}}
`;

export const DEFAULT_LICENSE_TEMPLATE = `License Type:
{{LICENSE_TYPE}}

Artwork ID:
{{ARTWORK_ID}}

Profile ID:
{{PROFILE_ID}}

SKU:
{{SKU}}

Company:
{{COMPANY_NAME}}

Copyright Owner:
{{COPYRIGHT_OWNER}}

For support contact:

{{CONTACT_NAME}}
{{EMAIL}}
{{PHONE}}
{{WEBSITE}}
{{SUPPORT_URL}}

Generated:
{{CURRENT_DATE}}
`;

async function loadTemplate(templatePath: string, fallback: string) {
  try {
    return await fs.readFile(templatePath, 'utf-8');
  } catch {
    return fallback;
  }
}

export function renderTemplate(template: string, values: TemplateValues) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token: string) => {
    return Object.prototype.hasOwnProperty.call(values, token) ? values[token] : match;
  });
}

async function writeRenderedTemplate(
  templatePath: string,
  fallbackTemplate: string,
  outputPath: string,
  values: TemplateValues
) {
  const template = await loadTemplate(templatePath, fallbackTemplate);
  const rendered = renderTemplate(template, values);
  await fs.writeFile(outputPath, rendered.endsWith('\n') ? rendered : `${rendered}\n`, 'utf-8');
  return outputPath;
}

function clean(value: string | null | undefined) {
  return value || '';
}

function formatFileTypes(fileTypes: string[]) {
  return Array.from(new Set(fileTypes.map((type) => type.toUpperCase()).filter(Boolean))).join('\n');
}

function normalizeUserTemplateVariables(variables: Record<string, string> | null | undefined) {
  const normalized: TemplateValues = {};

  for (const [key, value] of Object.entries(variables || {})) {
    const normalizedKey = key.trim().toUpperCase();
    if (/^[A-Z0-9_]+$/.test(normalizedKey)) {
      normalized[normalizedKey] = value;
    }
  }

  return normalized;
}

function setKnownUserValue(values: TemplateValues, key: string, value: string | null | undefined) {
  const cleaned = clean(value);
  if (cleaned || !Object.prototype.hasOwnProperty.call(values, key)) {
    values[key] = cleaned;
  }
}

export async function generatePackageDocuments(input: GeneratePackageDocumentsInput) {
  const settings = input.settings || {};
  const templatesDir = input.settings?.templatePath || path.join(input.baseAssetsPath, 'templates');
  const now = new Date();
  const currentYear = String(now.getFullYear());
  const currentDate = now.toISOString().slice(0, 10);
  const artworkId = clean(input.artworkId);
  const profileId = clean(input.profileId);
  const productName = clean(input.productName);
  const userValues = normalizeUserTemplateVariables(settings.templateVariables);
  setKnownUserValue(userValues, 'COMPANY_NAME', settings.companyName);
  setKnownUserValue(userValues, 'CONTACT_NAME', settings.contactName);
  setKnownUserValue(userValues, 'WEBSITE', settings.website);
  setKnownUserValue(userValues, 'EMAIL', settings.email);
  setKnownUserValue(userValues, 'PHONE', settings.phone);
  setKnownUserValue(userValues, 'SUPPORT_URL', settings.supportUrl);
  setKnownUserValue(userValues, 'LICENSE_TYPE', settings.defaultLicenseType);

  const values: TemplateValues = {
    ...userValues,
    ARTWORK_ID: artworkId,
    PROFILE_ID: profileId,
    SKU: clean(input.sku),
    PRODUCT_NAME: productName,
    FILE_TYPES: formatFileTypes(input.fileTypes),
    CURRENT_YEAR: currentYear,
    CURRENT_DATE: currentDate,
    PURCHASE_DATE: currentDate,
    ARTWORK_TITLE: clean(input.artworkTitle) || productName,
    PROFILE_TYPE: clean(input.profileType),
  };

  const readmePath = await writeRenderedTemplate(
    path.join(templatesDir, 'README-template.txt'),
    DEFAULT_README_TEMPLATE,
    getReadmePath(input.outputDir),
    values
  );
  const licensePath = await writeRenderedTemplate(
    path.join(templatesDir, 'LICENSE-template.txt'),
    DEFAULT_LICENSE_TEMPLATE,
    getLicensePath(input.outputDir),
    values
  );

  return {
    readmePath,
    licensePath,
  };
}
