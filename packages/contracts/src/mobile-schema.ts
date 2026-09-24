import { z } from 'zod';
import { batchSchema, eventSchema, onboardingDefinitionSchema } from './index.js';
import { feedbackReceiptSchema, feedbackSubmissionSchema } from './mobile-feedback.js';
import { batchResultSchema } from './mobile-response.js';
import { MOBILE_CONTRACT_VERSION, MOBILE_LIMITS } from './mobile-constants.js';

/** Build artifacts from runtime validation, never a parallel hand-maintained schema. */
export function mobileContractArtifacts(): Record<string, unknown> {
  const generated: Record<string, unknown> = {};
  const schemas = {
    event: eventSchema,
    batch: batchSchema,
    'batch-result': batchResultSchema,
    'onboarding-definition': onboardingDefinitionSchema,
    'feedback-submission': feedbackSubmissionSchema,
    'feedback-receipt': feedbackReceiptSchema,
  };
  for (const [name, schema] of Object.entries(schemas)) {
    generated[`${name}.schema.json`] = {
      ...z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'throw' }),
      $id: `https://appbase.so/contracts/mobile/v${MOBILE_CONTRACT_VERSION}/${name}.schema.json`,
      $comment:
        'GENERATED from canonical Zod schemas. Do not edit. Custom refinements, conservative client UTF-16 limits and UTF-8 byte limits require behavior.md and validation-vectors.json; standard JSON Schema alone is not equivalent to server validation.',
      'x-appbase-contract-version': MOBILE_CONTRACT_VERSION,
      'x-appbase-semantics': 'behavior.md',
    };
  }
  generated['limits.json'] = { contractVersion: MOBILE_CONTRACT_VERSION, ...MOBILE_LIMITS };
  return generated;
}
