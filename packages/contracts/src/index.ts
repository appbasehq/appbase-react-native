import { z } from 'zod';
import { MOBILE_LIMITS as limits } from './mobile-constants.js';
export { MOBILE_LIMITS, MOBILE_CONTRACT_VERSION } from './mobile-constants.js';
export { feedbackSubmissionSchema, feedbackReceiptSchema } from './mobile-feedback.js';
export { batchResultSchema } from './mobile-response.js';
import { revenuecatIdentityPropertiesSchema } from './revenuecat.js';
import type { AnalyticsEvent } from './types.js';
export type * from './types.js';
export * from './revenuecat.js';
export const trackingLabel = z
  .string()
  .trim()
  .regex(
    new RegExp(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,${limits.labelLength - 1}}$`),
    'Use 1–80 letters, numbers, dots, dashes or underscores',
  );
export const createAppSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z
      .string()
      .trim()
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by dashes'),
  })
  .strict();
export type CreateAppInput = z.infer<typeof createAppSchema>;
export const onboardingQuestionSchema = z
  .object({
    id: trackingLabel,
    stepId: trackingLabel,
    title: z.string().trim().min(1).max(limits.questionTitleLength),
    type: z.enum(['single', 'multiple']),
    options: z
      .array(
        z
          .object({
            id: trackingLabel,
            label: z.string().trim().min(1).max(limits.optionLabelLength),
          })
          .strict(),
      )
      .min(1)
      .max(limits.questionOptions)
      .refine(
        (options) => new Set(options.map((o) => o.id)).size === options.length,
        'Option IDs must be unique',
      ),
  })
  .strict();
export const onboardingDefinitionSchema = z
  .object({
    id: trackingLabel,
    version: trackingLabel,
    steps: z
      .array(trackingLabel)
      .min(1)
      .max(limits.onboardingSteps)
      .refine((steps) => new Set(steps).size === steps.length, 'Step IDs must be unique'),
    questions: z.array(onboardingQuestionSchema).max(limits.onboardingQuestions).optional(),
  })
  .strict()
  .superRefine((flow, ctx) => {
    const questions = flow.questions ?? [];
    if (new Set(questions.map((q) => q.id)).size !== questions.length)
      ctx.addIssue({ code: 'custom', message: 'Question IDs must be unique within a flow' });
    if (questions.some((q) => !flow.steps.includes(q.stepId)))
      ctx.addIssue({ code: 'custom', message: 'Questions must belong to a declared step' });
    if (new TextEncoder().encode(JSON.stringify(flow)).length > limits.onboardingDefinitionBytes)
      ctx.addIssue({ code: 'custom', message: 'Onboarding definition exceeds 16 KiB' });
  });
export const onboardingAnswerSchema = z
  .object({
    flow_id: trackingLabel,
    flow_version: trackingLabel,
    attempt_id: z.uuid(),
    step_id: trackingLabel,
    question_id: trackingLabel,
    answer_status: z.enum(['answered', 'skipped']),
    answer_ids: z
      .array(trackingLabel)
      .max(limits.propertyArrayLength)
      .refine((ids) => new Set(ids).size === ids.length, 'Selected answers must be unique'),
    answer_revision: z.number().int().min(1).max(limits.maximumSafeInteger),
  })
  .passthrough()
  .superRefine((answer, ctx) => {
    if ((answer.answer_status === 'skipped') !== (answer.answer_ids.length === 0))
      ctx.addIssue({
        code: 'custom',
        message: 'Skipped answers must be empty; answered questions need a selection',
      });
  });
export const collectionStateSchema = z.object({ enabled: z.boolean() }).strict();
const property = z.union([
  z.string().max(limits.propertyStringLength),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(limits.propertyArrayStringLength)).max(limits.propertyArrayLength),
]);
const storeId = z
  .string()
  .min(1)
  .max(limits.storeIdLength)
  .refine((s) => s.trim() === s, 'Invalid store identifier');
const paywallContext = z
  .object({
    paywall_id: trackingLabel,
    paywall_version: trackingLabel,
    paywall_view_id: z.uuid(),
    placement: trackingLabel,
    paywall_access_state: z.enum(['inactive', 'active', 'unknown']).optional(),
    product_ids: z
      .array(storeId)
      .min(1)
      .max(limits.propertyArrayLength)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    flow_id: trackingLabel.optional(),
    flow_version: trackingLabel.optional(),
    onboarding_attempt_id: z.uuid().optional(),
  })
  .passthrough()
  .superRefine((p, ctx) => {
    if (
      [p.flow_id, p.flow_version, p.onboarding_attempt_id].some((v) => v !== undefined) &&
      ![p.flow_id, p.flow_version, p.onboarding_attempt_id].every((v) => v !== undefined)
    )
      ctx.addIssue({ code: 'custom', message: 'Supply the complete onboarding context' });
  });
const paywallProduct = z
  .object({ product_id: storeId, offer_id: storeId.optional() })
  .passthrough();
const paywallPurchase = z.object({ purchase_attempt_id: z.uuid() }).passthrough();
const paywallResult = z
  .object({
    result: z.enum(['succeeded', 'cancelled', 'failed', 'pending']),
    result_source: z.literal('client'),
    transaction_id: storeId.optional(),
    error_code: storeId.optional(),
  })
  .passthrough();
const paywallDismissal = z
  .object({ dismiss_reason: z.enum(['close_button', 'back', 'purchased', 'other']) })
  .passthrough();
const paywallActions = [
  'paywall_product_selected',
  'paywall_purchase_started',
  'paywall_purchase_result',
  'paywall_dismissed',
];
export const eventSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: z.uuid(),
    installation_id: z.uuid(),
    anonymous_id: z.uuid(),
    user_id: z.string().min(1).max(limits.userIdLength).optional(),
    name: z.string().regex(new RegExp(`^[a-z][a-z0-9_.]{0,${limits.eventNameLength - 1}}$`)),
    occurred_at: z.iso.datetime({ offset: true }),
    platform: z.enum(['ios', 'android', 'test']),
    app_version: z.string().min(1).max(limits.appVersionLength),
    properties: z
      .record(z.string().min(1).max(limits.propertyKeyLength), property)
      .refine((p) => Object.keys(p).length <= limits.propertyCount, 'Too many properties')
      .refine(
        (p) => new TextEncoder().encode(JSON.stringify(p)).length <= limits.propertiesBytes,
        'Properties exceed 8 KiB',
      ),
    onboarding: onboardingDefinitionSchema.optional(),
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.name === 'onboarding_answered') {
      const answer = onboardingAnswerSchema.safeParse(event.properties);
      if (!answer.success)
        for (const issue of answer.error.issues)
          ctx.addIssue({
            code: 'custom',
            message: issue.message,
            path: ['properties', ...issue.path],
          });
      if (!event.onboarding)
        ctx.addIssue({ code: 'custom', message: 'Answers require an onboarding definition' });
      else if (answer.success) {
        const q = event.onboarding.questions?.find((q) => q.id === answer.data.question_id);
        if (
          !q ||
          q.stepId !== answer.data.step_id ||
          answer.data.answer_ids.some((id) => !q.options.some((o) => o.id === id)) ||
          (q.type === 'single' && answer.data.answer_ids.length > 1)
        )
          ctx.addIssue({ code: 'custom', message: 'Answer does not match its declared question' });
      }
    }
    if (event.name === 'revenuecat_identity_linked') {
      const parsed = revenuecatIdentityPropertiesSchema.safeParse(event.properties);
      if (!parsed.success)
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid client RevenueCat identity evidence',
          path: ['properties'],
        });
    }
    // Keep legacy placement/version-only views compatible. New helper events have explicit links.
    if (
      paywallActions.includes(event.name) ||
      (event.name === 'paywall_viewed' &&
        ['paywall_id', 'paywall_view_id', 'product_ids', 'onboarding_attempt_id'].some(
          (k) => k in event.properties,
        ))
    ) {
      const schemas: z.ZodType[] = [paywallContext];
      if (
        [
          'paywall_product_selected',
          'paywall_purchase_started',
          'paywall_purchase_result',
        ].includes(event.name)
      )
        schemas.push(paywallProduct);
      if (['paywall_purchase_started', 'paywall_purchase_result'].includes(event.name))
        schemas.push(paywallPurchase);
      if (event.name === 'paywall_purchase_result') schemas.push(paywallResult);
      if (event.name === 'paywall_dismissed') schemas.push(paywallDismissal);
      for (const schema of schemas) {
        const parsed = schema.safeParse(event.properties);
        if (!parsed.success)
          for (const issue of parsed.error.issues)
            ctx.addIssue({
              code: 'custom',
              message: issue.message,
              path: ['properties', ...issue.path],
            });
      }
      if (
        typeof event.properties.product_id === 'string' &&
        Array.isArray(event.properties.product_ids) &&
        !event.properties.product_ids.includes(event.properties.product_id)
      )
        ctx.addIssue({ code: 'custom', message: 'Product was not listed on this paywall view' });
    }
    const required = event.name.startsWith('onboarding_')
      ? ['flow_id', 'flow_version', 'attempt_id']
      : event.name === 'paywall_viewed'
        ? ['placement', 'paywall_version']
        : event.name === 'activity_completed'
          ? ['activity']
          : [];
    if (event.name === 'onboarding_step_viewed') required.push('step_id');
    if (event.onboarding) {
      if (
        ![
          'onboarding_started',
          'onboarding_step_viewed',
          'onboarding_completed',
          'onboarding_answered',
        ].includes(event.name)
      )
        ctx.addIssue({ code: 'custom', message: 'Flow metadata requires an onboarding event' });
      if (
        event.properties.flow_id !== event.onboarding.id ||
        event.properties.flow_version !== event.onboarding.version
      )
        ctx.addIssue({ code: 'custom', message: 'Flow metadata must match event properties' });
      if (
        event.name === 'onboarding_step_viewed' &&
        !event.onboarding.steps.includes(String(event.properties.step_id))
      )
        ctx.addIssue({ code: 'custom', message: 'Step is not in this onboarding definition' });
    }
    for (const key of required) {
      if (typeof event.properties[key] !== 'string' || !event.properties[key])
        ctx.addIssue({ code: 'custom', message: `Missing ${key}`, path: ['properties', key] });
    }
    if (event.name === 'identity_linked' && !event.user_id)
      ctx.addIssue({ code: 'custom', message: 'Identity requires user_id' });
    if (event.name.startsWith('subscription_'))
      ctx.addIssue({
        code: 'custom',
        message: 'Subscription events require a verified server integration',
      });
  }) satisfies z.ZodType<AnalyticsEvent>;
export const batchSchema = z
  .object({ events: z.array(z.unknown()).min(1).max(limits.batchEvents) })
  .strict();
export const dateRangeSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 90 * 86400000,
    'Choose a range from 1 to 90 days; to is exclusive',
  );

export const journeyParamsSchema = z.object({
  subject: z
    .string()
    .max(202)
    .refine((s) =>
      s.startsWith('u:')
        ? s.length > 2
        : s.startsWith('a:') && z.uuid().safeParse(s.slice(2)).success,
    ),
  cursor: z.string().max(400).optional(),
});
export const journeyCursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() }).strict();
