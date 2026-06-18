import fs from 'fs/promises';
import path from 'path';
import {
  type CompositeTemplate,
  validateCompositeTemplate,
} from '@/lib/composite-template-schema';

export interface CompositeTemplateLoadIssue {
  filePath?: string;
  templateId?: string;
  message: string;
}

export interface CompositeTemplateLoadResult {
  templates: CompositeTemplate[];
  warnings: CompositeTemplateLoadIssue[];
  errors: CompositeTemplateLoadIssue[];
}

export function getCompositeTemplatesDir(baseAssetsPath: string) {
  return path.join(baseAssetsPath, 'templates', 'composites');
}

export function getCompositeTemplatesDirFromTemplatePath(templatePath: string) {
  return path.join(templatePath, 'composites');
}

async function readTemplateFile(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

export async function loadCompositeTemplates(
  baseAssetsPath = './base-assets',
  templatePath?: string
): Promise<CompositeTemplateLoadResult> {
  const templatesDir = templatePath
    ? getCompositeTemplatesDirFromTemplatePath(templatePath)
    : getCompositeTemplatesDir(baseAssetsPath);
  const templates: CompositeTemplate[] = [];
  const warnings: CompositeTemplateLoadIssue[] = [];
  const errors: CompositeTemplateLoadIssue[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(templatesDir);
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: string }).code : '';
    if (code === 'ENOENT') {
      warnings.push({
        filePath: templatesDir,
        message: 'Composite templates folder does not exist yet',
      });
      return { templates, warnings, errors };
    }

    errors.push({
      filePath: templatesDir,
      message: error instanceof Error ? error.message : String(error),
    });
    return { templates, warnings, errors };
  }

  for (const entry of entries.filter((name) => name.toLowerCase().endsWith('.json')).sort()) {
    const filePath = path.join(templatesDir, entry);

    try {
      const template = await readTemplateFile(filePath);
      const validation = validateCompositeTemplate(template);
      const templateId =
        template && typeof template === 'object' && 'id' in template
          ? String((template as { id?: unknown }).id || '')
          : undefined;

      for (const warning of validation.warnings) {
        warnings.push({ filePath, templateId, message: warning });
      }

      if (!validation.valid) {
        for (const validationError of validation.errors) {
          errors.push({ filePath, templateId, message: validationError });
        }
        continue;
      }

      templates.push(template as CompositeTemplate);
    } catch (error) {
      errors.push({
        filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { templates, warnings, errors };
}
