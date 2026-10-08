import { z } from 'zod';
import { MOBILE_LIMITS } from './mobile-constants.js';

/** One SDK event, with exact, typed scalar-property matches joined by AND. */
export const acquisitionDefinitionSchema = z
  .object({
    event: z
      .string()
      .regex(new RegExp(`^[a-z][a-z0-9_.]{0,${MOBILE_LIMITS.eventNameLength - 1}}$`)),
    properties: z
      .record(
        z.string().min(1).max(MOBILE_LIMITS.propertyKeyLength),
        z.union([
          z.string().max(MOBILE_LIMITS.propertyStringLength),
          z.number().finite(),
          z.boolean(),
          z.null(),
        ]),
      )
      .refine((p) => Object.keys(p).length <= 10, 'Use at most 10 property matches')
      .default({}),
  })
  .strict();
export const acquisitionSaveSchema = z
  .object({
    definition: acquisitionDefinitionSchema.nullable(),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const acquisitionPreviewSchema = z
  .object({ definition: acquisitionDefinitionSchema })
  .strict();
export interface AcquisitionDefinition {
  event: string;
  properties: Record<string, string | number | boolean | null>;
}
export interface AcquisitionConfiguration {
  definition: AcquisitionDefinition | null;
  revision: number;
  updated_at: string | null;
}
export interface AcquisitionPreview {
  configuration: AcquisitionConfiguration;
  proposed: AcquisitionDefinition;
  matched_events: number;
  users: number;
  first_match_at: string | null;
  last_match_at: string | null;
  users_with_earlier_activity: number;
  historical_imports: number;
  as_of: string;
}
