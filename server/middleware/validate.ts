/**
 * Validation Middleware
 * Provides reusable validation for request body, params, and query
 */
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Format Zod errors into a user-friendly structure
 */
function formatZodErrors(error: ZodError): { field: string; message: string }[] {
    return error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message
    }));
}

/**
 * Validate request body against a Zod schema
 */
export function validateBody<T extends ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: formatZodErrors(result.error)
            });
        }

        // Replace body with validated & stripped data
        req.body = result.data;
        next();
    };
}

/**
 * Validate request params against a Zod schema
 */
export function validateParams<T extends ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.params);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL Parameters',
                details: formatZodErrors(result.error)
            });
        }

        // Params are read-only, but we can attach validated data
        (req as any).validatedParams = result.data;
        next();
    };
}

/**
 * Validate request query against a Zod schema
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.query);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Query Parameters',
                details: formatZodErrors(result.error)
            });
        }

        // Attach validated query data
        (req as any).validatedQuery = result.data;
        next();
    };
}

/**
 * Combined validation for body, params, and query
 */
export function validate(options: {
    body?: ZodSchema;
    params?: ZodSchema;
    query?: ZodSchema;
}) {
    return (req: Request, res: Response, next: NextFunction) => {
        const errors: { field: string; message: string }[] = [];

        if (options.body) {
            const result = options.body.safeParse(req.body);
            if (!result.success) {
                errors.push(...formatZodErrors(result.error));
            } else {
                req.body = result.data;
            }
        }

        if (options.params) {
            const result = options.params.safeParse(req.params);
            if (!result.success) {
                errors.push(...formatZodErrors(result.error).map(e => ({
                    ...e,
                    field: `params.${e.field}`
                })));
            } else {
                (req as any).validatedParams = result.data;
            }
        }

        if (options.query) {
            const result = options.query.safeParse(req.query);
            if (!result.success) {
                errors.push(...formatZodErrors(result.error).map(e => ({
                    ...e,
                    field: `query.${e.field}`
                })));
            } else {
                (req as any).validatedQuery = result.data;
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: errors
            });
        }

        next();
    };
}

export default { validateBody, validateParams, validateQuery, validate };
