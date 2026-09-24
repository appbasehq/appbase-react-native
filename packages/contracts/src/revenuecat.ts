import { z } from 'zod';
import { MOBILE_LIMITS } from './mobile-constants.js';

const opaque = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim() === s && !/[\u0000-\u001f]/.test(s));
export const revenuecatSecretRef = z
  .string()
  .max(100)
  .regex(/^REVENUECAT_SIGNING_SECRET_[A-Z0-9_]+$/);
export const revenuecatConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    project_id: opaque(255),
    signing_secret_env: revenuecatSecretRef.nullable().optional(),
  })
  .strict();
export const revenuecatSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    signing_secret_env: revenuecatSecretRef.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const revenuecatMappingSchema = z
  .object({
    provider_app_id: opaque(255),
    store: z.enum(['APP_STORE', 'PLAY_STORE', 'TEST_STORE']),
    environment: z.enum(['SANDBOX', 'PRODUCTION']),
    app_id: z.uuid(),
  })
  .strict()
  .refine((v) => v.store !== 'TEST_STORE' || v.environment === 'SANDBOX');
export const revenuecatReplaySchema = z
  .object({ event_ids: z.array(opaque(255)).min(1).max(100) })
  .strict();

// Only the stable envelope is required at receipt. Lifecycle validation happens later.
// Unknown provider fields/types remain in the original body for future processing.
export const revenuecatEnvelopeSchema = z
  .object({
    api_version: opaque(40),
    event: z
      .object({
        id: opaque(255),
        type: opaque(100),
        event_timestamp_ms: z.number().int().min(0).max(253402300799999),
      })
      .passthrough(),
  })
  .passthrough();
export type RevenueCatEnvelope = z.infer<typeof revenuecatEnvelopeSchema>;

export const revenuecatAppUserIdSchema = z
  .string()
  .min(1)
  .max(MOBILE_LIMITS.providerIdLength)
  .refine((s) => s.trim() === s && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(s));
export const revenuecatIdentityPropertiesSchema = z
  .object({
    revenuecat_project_id: revenuecatAppUserIdSchema,
    revenuecat_app_user_id: revenuecatAppUserIdSchema,
    link_source: z.literal('client'),
  })
  .strict();
