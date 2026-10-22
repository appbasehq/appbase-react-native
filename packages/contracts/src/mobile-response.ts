import { z } from 'zod';
import { MOBILE_LIMITS } from './mobile-constants.js';

/** Server steering for one collection key's SDKs. Clients clamp every value to the bounds in
 * limits.json, persist it, and ignore fields they do not know; see behavior.md. */
export const collectionControlSchema = z
  .object({
    min_retry_ms: z.number().int().min(0).optional(),
    flush_interval_ms: z.number().int().min(0).optional(),
    max_batch: z.number().int().min(1).max(MOBILE_LIMITS.batchEvents).optional(),
    disabled_until: z.iso.datetime({ offset: true }).optional(),
    purge: z.boolean().optional(),
  })
  .strict();

/** Wire response includes null IDs for malformed incoming events. A client must never
 * delete queued events based on null IDs or IDs outside the submitted batch. */
export const batchResultSchema = z.object({
  accepted: z.array(z.uuid()),
  rejected: z.array(z.object({ event_id: z.uuid().nullable(), reason: z.string() })),
  /** Accepted events with a setup problem worth fixing. Older servers omit it. */
  warnings: z.array(z.object({ event_id: z.uuid(), message: z.string() })).optional(),
  control: collectionControlSchema.optional(),
});
