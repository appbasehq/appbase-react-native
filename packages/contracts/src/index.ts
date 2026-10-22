import { z } from 'zod';
import { MOBILE_LIMITS as limits } from './mobile-constants.js';
export { MOBILE_LIMITS, MOBILE_CONTRACT_VERSION } from './mobile-constants.js';
export { feedbackSubmissionSchema, feedbackReceiptSchema } from './mobile-feedback.js';
export { batchResultSchema, collectionControlSchema } from './mobile-response.js';
import { revenuecatIdentityPropertiesSchema } from './revenuecat.js';
import type {
  AnalyticsEvent,
  JourneyEvent,
  StoredBillingEvent,
  StoredEvent,
  StoredServerEvent,
} from './types.js';
export type * from './types.js';
export * from './revenuecat.js';
export * from './reporting.js';
export * from './agent-analytics.js';
export * from './acquisition.js';
export * from './ad-return.js';
export * from './period-overview.js';
export * from './plans.js';
/** PostgreSQL text/jsonb cannot store NUL or unpaired UTF-16 surrogates; reject them per event. */
export const storableText = (value: string) => !/[\u0000\uD800-\uDFFF]/u.test(value);
const unstorable = 'Text contains a NUL or unpaired surrogate character';
const storable = (schema: z.ZodString) => schema.refine(storableText, unstorable);
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
/** The owner's setup flow also records the App Store listing, or that the app is not released. */
export const ownerCreateAppSchema = createAppSchema
  .extend({
    release_status: z.enum(['live', 'unreleased']).optional(),
    app_store_id: z
      .string()
      .regex(/^[0-9]{1,20}$/)
      .optional(),
    bundle_id: z
      .string()
      .regex(/^[A-Za-z0-9.-]{1,155}$/)
      .optional(),
  })
  .strict()
  .refine(
    (app) =>
      app.release_status === 'live'
        ? Boolean(app.app_store_id && app.bundle_id)
        : !app.app_store_id && !app.bundle_id,
    'A live app needs its App Store ID and bundle ID; other apps have neither',
  );
export type OwnerCreateAppInput = z.infer<typeof ownerCreateAppSchema>;
/** App icons are stored small: a square PNG, JPEG or WebP of at most 256 KiB. */
export const appIconTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const appIconMaxBytes = 262144;
export const appIconUploadSchema = z
  .object({
    content_type: z.enum(appIconTypes),
    data: z
      .string()
      .max(Math.ceil(appIconMaxBytes / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export const onboardingQuestionSchema = z
  .object({
    id: trackingLabel,
    stepId: trackingLabel,
    title: storable(z.string().trim().min(1).max(limits.questionTitleLength)),
    type: z.enum(['single', 'multiple']),
    options: z
      .array(
        z
          .object({
            id: trackingLabel,
            label: storable(z.string().trim().min(1).max(limits.optionLabelLength)),
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
  storable(z.string().max(limits.propertyStringLength)),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z
    .array(storable(z.string().max(limits.propertyArrayStringLength)))
    .max(limits.propertyArrayLength),
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
/**
 * `profile_updated` replaces the identified account's dashboard label. The server stores it apart
 * from events; both fields are always sent and null clears one.
 */
export const profileEmailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const profilePropertiesSchema = z
  .object({
    email: storable(
      z.string().min(3).max(limits.feedbackEmailLength).regex(profileEmailPattern),
    ).nullable(),
    name: storable(z.string().min(1).max(limits.profileNameLength))
      .refine((s) => s.trim() === s && !/[\u0000-\u001f\u007f]/.test(s), 'Trim the name')
      .nullable(),
  })
  .strict();
const eventName = z
  .string()
  .regex(new RegExp(`^[a-z][a-z0-9_.]{0,${limits.eventNameLength - 1}}$`));
const eventProperties = z
  .record(storable(z.string().min(1).max(limits.propertyKeyLength)), property)
  .refine((p) => Object.keys(p).length <= limits.propertyCount, 'Too many properties')
  .refine(
    (p) => new TextEncoder().encode(JSON.stringify(p)).length <= limits.propertiesBytes,
    'Properties exceed 8 KiB',
  );
export const runtimeEnvironmentSchema = z.enum(['production', 'sandbox', 'development', 'unknown']);
export const reportingEnvironmentSchema = z.enum(['production', 'sandbox', 'development']);
export const eventSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: z.uuid(),
    installation_id: z.uuid(),
    anonymous_id: z.uuid(),
    user_id: storable(z.string().min(1).max(limits.userIdLength)).optional(),
    name: eventName,
    occurred_at: z.iso.datetime({ offset: true }),
    platform: z.enum(['ios', 'android', 'test']),
    app_version: storable(z.string().min(1).max(limits.appVersionLength)),
    runtime_environment: runtimeEnvironmentSchema.optional(),
    properties: eventProperties,
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
    if (event.name === 'profile_updated') {
      if (!profilePropertiesSchema.safeParse(event.properties).success)
        ctx.addIssue({
          code: 'custom',
          message: 'A profile has a valid email and name, each possibly null',
          path: ['properties'],
        });
      if (!event.user_id)
        ctx.addIssue({ code: 'custom', message: 'A profile needs an identified user' });
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
    (v) => Date.parse(v.from) >= 0 && Date.parse(v.to) > Date.parse(v.from),
    'Choose an ordered UTC date range from 1970 onward; to is exclusive',
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
/** Owner marks (or unmarks) one person as a tester; Production reports leave testers out. */
export const testerMarkSchema = journeyParamsSchema
  .pick({ subject: true })
  .extend({ is_tester: z.boolean() })
  .strict();
/** Setup access marks an account the agent already knows (the owner's or a test account). */
export const agentTesterMarkSchema = z
  .object({ user_id: storable(z.string().min(1).max(limits.userIdLength)), is_tester: z.boolean() })
  .strict();
/** Owner retires (or restores) one paywall design version; the Paywalls card folds it away. */
export const paywallRetirementSchema = z
  .object({ paywall_id: trackingLabel, version: trackingLabel, retired: z.boolean() })
  .strict();
/** Owner hides or shows a custom event on the Feature usage card. */
export const featureHiddenSchema = z.object({ event: eventName, hidden: z.boolean() }).strict();
/** Owner deletes one person (an account with its linked history, or an unlinked install). */
export const personDeletionSchema = journeyParamsSchema.pick({ subject: true }).strict();
/** The app's backend deletes one account's analytics when that account is deleted. */
export const serverPersonDeletionSchema = z
  .object({ user_id: storable(z.string().min(1).max(limits.userIdLength)) })
  .strict();
/**
 * Names server events cannot use: the app's own lifecycle, identity, onboarding, paywall and
 * billing evidence comes only from the SDK or verified billing providers.
 */
export const serverReservedEventNames = [
  'app_first_open',
  'app_active',
  'identity_linked',
  'activity_completed',
] as const;
export const serverReservedEventPrefixes = [
  'onboarding_',
  'paywall_',
  'subscription_',
  'revenuecat_',
] as const;
/**
 * One event from the app's backend about an identified account. `event_id` is the sender's own
 * idempotency key (a UUID or any stable text such as `transcription:memo_123`); `active` says
 * whether the person did it (counts toward active users) or it happened for them.
 * `profile_updated` sets the account's dashboard label, as the SDK's setProfile does.
 */
export const serverEventSchema = z
  .object({
    event_id: z
      .string()
      .regex(/^[\x21-\x7e]{1,200}$/, 'Use 1–200 visible ASCII characters, no spaces'),
    user_id: storable(z.string().min(1).max(limits.userIdLength)),
    name: eventName,
    occurred_at: z.iso.datetime({ offset: true }).optional(),
    active: z.boolean().optional(),
    environment: z.enum(['production', 'development']).optional(),
    properties: eventProperties.optional(),
  })
  .strict()
  .superRefine((event, ctx) => {
    if (
      (serverReservedEventNames as readonly string[]).includes(event.name) ||
      serverReservedEventPrefixes.some((prefix) => event.name.startsWith(prefix))
    )
      ctx.addIssue({
        code: 'custom',
        message: `${event.name} is sent by the app's SDK, not a server`,
        path: ['name'],
      });
    if (event.name === 'profile_updated') {
      if (!profilePropertiesSchema.safeParse(event.properties ?? {}).success)
        ctx.addIssue({
          code: 'custom',
          message: 'A profile has a valid email and name, each possibly null',
          path: ['properties'],
        });
    } else if (event.active === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'Set active: true when the person did this, false when it happened for them',
        path: ['active'],
      });
  });
export type ServerEvent = z.infer<typeof serverEventSchema>;
/** Whether a journey event came from the app's backend rather than the app. */
export const isServerEvent = (event: JourneyEvent): event is StoredServerEvent =>
  event.source === 'server';
/** Whether a journey event is a RevenueCat billing event of the person's linked customer. */
export const isBillingEvent = (event: JourneyEvent): event is StoredBillingEvent =>
  event.source === 'revenuecat';
/** Whether a journey event came from the app itself (the SDK). */
export const isAppEvent = (event: JourneyEvent): event is StoredEvent =>
  !isServerEvent(event) && !isBillingEvent(event);
export const journeyCursorSchema = z
  .object({
    at: z.iso.datetime(),
    id: z.uuid(),
    scope: z
      .string()
      .regex(/^[a-f0-9]{24}$/)
      .optional(),
  })
  .strict();
