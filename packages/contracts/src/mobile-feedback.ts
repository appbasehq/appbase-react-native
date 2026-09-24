import { z } from 'zod';
import { MOBILE_LIMITS as limits } from './mobile-constants.js';

/** Canonical feedback wire validation, shared with the HTTP endpoint. */
export const feedbackSubmissionSchema = z
  .object({
    id: z.uuid(),
    message: z
      .string()
      .trim()
      .min(1)
      .max(limits.feedbackMessageLength)
      .refine((s) => !s.includes('\0')),
    email: z
      .string()
      .trim()
      .max(limits.feedbackEmailLength)
      .regex(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/)
      .optional(),
    platform: z.enum(['ios', 'android', 'test']),
    app_version: z.string().trim().min(1).max(limits.appVersionLength),
    anonymous_id: z.uuid().optional(),
    user_id: z
      .string()
      .trim()
      .min(1)
      .max(limits.userIdLength)
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s))
      .optional(),
  })
  .strict();

export const feedbackReceiptSchema = z.object({
  id: z.uuid(),
  received_at: z.iso.datetime({ offset: true }),
});
