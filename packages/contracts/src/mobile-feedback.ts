import { z } from 'zod';
import { MOBILE_LIMITS as limits } from './mobile-constants.js';

// Mirrors index.ts storableText; kept local to avoid an import cycle.
const storable = (value: string) => !/[\u0000\uD800-\uDFFF]/u.test(value);

/** Canonical feedback wire validation, shared with the HTTP endpoint. */
export const feedbackSubmissionSchema = z
  .object({
    id: z.uuid(),
    runtime_environment: z.enum(['production', 'sandbox', 'development', 'unknown']).optional(),
    message: z.string().trim().min(1).max(limits.feedbackMessageLength).refine(storable),
    email: z
      .string()
      .trim()
      .max(limits.feedbackEmailLength)
      .regex(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/)
      .refine(storable)
      .optional(),
    platform: z.enum(['ios', 'android', 'test']),
    app_version: z.string().trim().min(1).max(limits.appVersionLength).refine(storable),
    anonymous_id: z.uuid().optional(),
    user_id: z
      .string()
      .trim()
      .min(1)
      .max(limits.userIdLength)
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s) && storable(s))
      .optional(),
  })
  .strict();

export const feedbackReceiptSchema = z.object({
  id: z.uuid(),
  received_at: z.iso.datetime({ offset: true }),
});
