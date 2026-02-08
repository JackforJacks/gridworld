/**
 * Zod Validation Schemas
 * Centralized input validation for all API endpoints
 */
import { z } from 'zod';

// ============================================
// Population Schemas
// ============================================

export const UpdatePopulationSchema = z.object({
    rate: z.number().nonnegative().optional(),
    tilePopulations: z.record(z.string(), z.number().int().nonnegative()).optional()
}).refine(data => data.rate !== undefined || data.tilePopulations !== undefined, {
    message: 'Either rate or tilePopulations must be provided'
});

export const InitializePopulationSchema = z.object({
    habitableTiles: z.array(z.number().int().positive()),
    preserveDatabase: z.boolean().optional().default(false)
});

export const IntegrityCheckSchema = z.object({
    tiles: z.array(z.number().int()).nullable().optional(),
    repair: z.boolean().optional().default(false)
});

export const AssignFamilySchema = z.object({
    family_id: z.number().int().positive()
});

export const TileIdParamSchema = z.object({
    tileId: z.string().regex(/^\d+$/, 'tileId must be a numeric string')
});

// ============================================
// Calendar Schemas
// ============================================

// GridWorld uses a custom calendar: 8 days per month, 12 months per year
export const SetDateSchema = z.object({
    year: z.number().int().min(1).max(99999),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(8)
});

export const SetIntervalSchema = z.object({
    intervalMs: z.number().int().min(100).max(60000)
});

export const SetSpeedSchema = z.object({
    speed: z.string().min(1)
});

// ============================================
// Tiles Schemas
// ============================================

export const TilesQuerySchema = z.object({
    radius: z.string().optional(),
    subdivisions: z.string().optional(),
    tileWidthRatio: z.string().optional(),
    regenerate: z.string().optional(),
    t: z.string().optional(),
    silent: z.string().optional()
});

// ============================================
// API Schemas
// ============================================

export const WorldRestartSchema = z.object({
    confirm: z.literal('DELETE_ALL_DATA')
});

export const PopulationSyncSchema = z.object({}).optional();

// ============================================
// Statistics Schemas
// ============================================

export const YearsParamSchema = z.object({
    years: z.string().regex(/^\d+$/, 'years must be a numeric string').optional()
});

export const YearsQuerySchema = z.object({
    years: z.string().regex(/^\d+$/, 'years must be a numeric string').optional()
});

// ============================================
// Type Exports (inferred from schemas)
// ============================================

export type UpdatePopulationInput = z.infer<typeof UpdatePopulationSchema>;
export type InitializePopulationInput = z.infer<typeof InitializePopulationSchema>;
export type IntegrityCheckInput = z.infer<typeof IntegrityCheckSchema>;
export type AssignFamilyInput = z.infer<typeof AssignFamilySchema>;
export type SetDateInput = z.infer<typeof SetDateSchema>;
export type SetIntervalInput = z.infer<typeof SetIntervalSchema>;
export type SetSpeedInput = z.infer<typeof SetSpeedSchema>;
export type WorldRestartInput = z.infer<typeof WorldRestartSchema>;
