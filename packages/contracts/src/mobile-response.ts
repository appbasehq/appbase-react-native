import { z } from 'zod';

/** Wire response includes null IDs for malformed incoming events. A client must never
 * delete queued events based on null IDs or IDs outside the submitted batch. */
export const batchResultSchema = z.object({
  accepted: z.array(z.uuid()),
  rejected: z.array(z.object({ event_id: z.uuid().nullable(), reason: z.string() })),
});
