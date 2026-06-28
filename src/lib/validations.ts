import { z } from 'zod';
import { validateManagedPathValue } from '@/lib/path-management';

/**
 * Validation schemas for VectorForge
 */

// User settings validation
export const userSettingsSchema = z.object({
  defaultUpscaleFactor: z.number().int().min(1).max(4).refine((v) => [1, 2, 4].includes(v), {
    message: 'Upscale factor must be 1, 2, or 4',
  }),
  smartUpscaleThreshold: z.number().int().min(100).max(10000),
  baseAssetsPath: z
    .string()
    .min(1)
    .refine((p) => validateManagedPathValue(p) === null, {
      message: 'Path must be a valid relative or absolute local path',
    }),
  outputPath: z
    .string()
    .min(1)
    .refine((p) => validateManagedPathValue(p) === null, {
      message: 'Path must be a valid relative or absolute local path',
    }),
  defaultSubstitutions: z.record(z.string(), z.string()).optional(),
});

// Batch creation validation
export const createBatchSchema = z.object({
  name: z.string().optional(),
  upscaleFactor: z.number().int().min(1).max(4).refine((v) => [1, 2, 4].includes(v)),
  smartUpscaleThreshold: z.number().int().min(100).max(10000),
  useBaseAssets: z.boolean().default(true),
  substitutionData: z.record(z.string(), z.string()).optional(),
});

// Batch item update validation (for pre-conversion review)
export const updateBatchItemSchema = z.object({
  baseName: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Base name can only contain letters, numbers, hyphens, and underscores'),
  upscaleFactor: z
    .number()
    .int()
    .min(1)
    .max(4)
    .refine((v) => [1, 2, 4].includes(v))
    .optional(),
});

// Substitution data validation
export const substitutionDataSchema = z.object({
  data: z.record(z.string(), z.string()),
});

// File upload validation
export const fileUploadSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().refine(
    (type) => ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'].includes(type),
    { message: 'Unsupported file type. Use JPG, PNG, WebP, or TIFF.' }
  ),
  size: z.number().max(50 * 1024 * 1024, 'File size must be under 50MB'),
});

export type UserSettingsInput = z.infer<typeof userSettingsSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type UpdateBatchItemInput = z.infer<typeof updateBatchItemSchema>;
export type SubstitutionDataInput = z.infer<typeof substitutionDataSchema>;
