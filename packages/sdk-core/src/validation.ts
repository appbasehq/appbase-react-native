import { MOBILE_LIMITS } from '@mobile-analytics/contracts/mobile-constants';
import type { OnboardingDefinition, OnboardingQuestion } from '@mobile-analytics/contracts/types';
import { jsonBytes, validProperties } from './properties.js';

export const validUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(value)?.[0] === value;
export const validLabel = (value: unknown): value is string =>
  typeof value === 'string' &&
  new RegExp(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,${MOBILE_LIMITS.labelLength - 1}}$`).exec(value)?.[0] ===
    value;
export const validEventName = (value: unknown): value is string =>
  typeof value === 'string' &&
  new RegExp(`^[a-z][a-z0-9_.]{0,${MOBILE_LIMITS.eventNameLength - 1}}$`).exec(value)?.[0] ===
    value;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const oneOf = (value: unknown, values: readonly string[]): value is string =>
  typeof value === 'string' && values.includes(value);
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const uuidUnique = (values: string[]) => unique(values.map((value) => value.toLowerCase()));
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;
export const validStoreId = (value: unknown): value is string =>
  text(value, MOBILE_LIMITS.storeIdLength);
export const validProviderId = (value: unknown): value is string =>
  text(value, MOBILE_LIMITS.providerIdLength) && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value);

/** The same definition rules are used at registration and when restoring a workflow. */
export function validQuestions(
  value: unknown,
  steps: readonly string[],
): value is OnboardingQuestion[] {
  if (!Array.isArray(value) || value.length > MOBILE_LIMITS.onboardingQuestions) return false;
  const ids: string[] = [];
  for (const question of value) {
    if (
      !record(question) ||
      !validLabel(question.id) ||
      !validLabel(question.stepId) ||
      !steps.includes(question.stepId) ||
      !text(question.title, MOBILE_LIMITS.questionTitleLength) ||
      !oneOf(question.type, ['single', 'multiple']) ||
      !Array.isArray(question.options) ||
      question.options.length < 1 ||
      question.options.length > MOBILE_LIMITS.questionOptions
    )
      return false;
    const options: string[] = [];
    for (const option of question.options) {
      if (
        !record(option) ||
        !validLabel(option.id) ||
        !text(option.label, MOBILE_LIMITS.optionLabelLength)
      )
        return false;
      options.push(option.id);
    }
    if (!unique(options)) return false;
    ids.push(question.id);
  }
  return unique(ids);
}

export function validOnboardingDefinition(value: unknown): value is OnboardingDefinition {
  return (
    record(value) &&
    validLabel(value.id) &&
    validLabel(value.version) &&
    Array.isArray(value.steps) &&
    value.steps.length >= 1 &&
    value.steps.length <= MOBILE_LIMITS.onboardingSteps &&
    value.steps.every(validLabel) &&
    unique(value.steps) &&
    validQuestions(value.questions ?? [], value.steps) &&
    jsonBytes(value) <= MOBILE_LIMITS.onboardingDefinitionBytes
  );
}

function validOnboardingState(value: Record<string, unknown>): boolean {
  if (Object.keys(value).length > MOBILE_LIMITS.onboardingDefinitions) return false;
  const attempts: string[] = [];
  for (const [key, attempt] of Object.entries(value)) {
    if (
      !record(attempt) ||
      !validUuid(attempt.attemptId) ||
      !validOnboardingDefinition(attempt.definition) ||
      typeof attempt.completed !== 'boolean' ||
      !Number.isSafeInteger(attempt.nextStep)
    )
      return false;
    const definition = attempt.definition,
      nextStep = Number(attempt.nextStep);
    if (
      key !== `${definition.id}/${definition.version}` ||
      nextStep < 0 ||
      nextStep > definition.steps.length ||
      (attempt.completed && nextStep !== definition.steps.length) ||
      (attempt.answers !== undefined && !record(attempt.answers))
    )
      return false;
    for (const [id, answer] of Object.entries(attempt.answers ?? {})) {
      const question = definition.questions?.find((entry) => entry.id === id);
      if (
        !question ||
        definition.steps.indexOf(question.stepId) >= nextStep ||
        !record(answer) ||
        !positiveInteger(answer.revision)
      )
        return false;
      if (answer.values !== null) {
        if (
          !Array.isArray(answer.values) ||
          !answer.values.length ||
          !answer.values.every(validLabel) ||
          !unique(answer.values) ||
          (question.type === 'single' && answer.values.length !== 1)
        )
          return false;
        const selection = answer.values;
        const canonical = question.options
          .filter((option) => selection.includes(option.id))
          .map((option) => option.id);
        if (JSON.stringify(canonical) !== JSON.stringify(selection)) return false;
      }
    }
    attempts.push(attempt.attemptId);
  }
  return uuidUnique(attempts);
}

function validPaywallState(value: Record<string, unknown>): boolean {
  const entries = Object.entries(value),
    purchaseIds: string[] = [];
  if (entries.length > MOBILE_LIMITS.paywallViews || !uuidUnique(Object.keys(value))) return false;
  for (const [viewId, view] of entries) {
    if (
      !validUuid(viewId) ||
      !record(view) ||
      !record(view.context) ||
      !validProperties(view.context as never) ||
      !record(view.purchases) ||
      Object.keys(view.purchases).length > MOBILE_LIMITS.paywallPurchases
    )
      return false;
    const context = view.context;
    const version = Number(context.paywall_version);
    if (
      context.paywall_view_id !== viewId ||
      !validLabel(context.paywall_id) ||
      !validLabel(context.placement) ||
      !positiveInteger(version) ||
      String(version) !== context.paywall_version ||
      (context.paywall_access_state !== undefined &&
        !oneOf(context.paywall_access_state, ['inactive', 'active', 'unknown'])) ||
      (view.dismissed !== undefined &&
        !oneOf(view.dismissed, ['close_button', 'back', 'purchased', 'other']))
    )
      return false;
    const products = context.product_ids;
    if (
      products !== undefined &&
      (!Array.isArray(products) ||
        products.length < 1 ||
        products.length > MOBILE_LIMITS.propertyArrayLength ||
        !products.every(validStoreId) ||
        !unique(products))
    )
      return false;
    if (
      ['flow_id', 'flow_version', 'onboarding_attempt_id'].some(
        (key) => context[key] !== undefined,
      ) &&
      (!validLabel(context.flow_id) ||
        !validLabel(context.flow_version) ||
        !validUuid(context.onboarding_attempt_id))
    )
      return false;
    if (
      [
        'product_id',
        'offer_id',
        'purchase_attempt_id',
        'result',
        'result_source',
        'transaction_id',
        'error_code',
        'dismiss_reason',
      ].some((key) => context[key] !== undefined)
    )
      return false;
    for (const [attemptId, purchase] of Object.entries(view.purchases)) {
      if (
        !validUuid(attemptId) ||
        !record(purchase) ||
        !record(purchase.product) ||
        !validStoreId(purchase.product.productId) ||
        (purchase.product.offerId !== undefined && !validStoreId(purchase.product.offerId)) ||
        (Array.isArray(products) && !products.includes(purchase.product.productId))
      )
        return false;
      if (purchase.result !== undefined) {
        const result = purchase.result;
        if (
          !record(result) ||
          !oneOf(result.result, ['succeeded', 'cancelled', 'failed', 'pending']) ||
          (result.transactionId !== undefined && !validStoreId(result.transactionId)) ||
          (result.errorCode !== undefined && !validStoreId(result.errorCode))
        )
          return false;
      }
      purchaseIds.push(attemptId);
    }
  }
  return uuidUnique(purchaseIds);
}

/** Validate saved state without normalizing or replacing it. Legacy optional workflow
 * maps remain optional; queued events need not use the current anonymous/user identity. */
export function validStoredState(value: unknown): boolean {
  if (
    !record(value) ||
    value.version !== 1 ||
    !validUuid(value.installationId) ||
    !validUuid(value.anonymousId) ||
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.dropped) ||
    Number(value.dropped) < 0 ||
    (value.userId !== undefined &&
      (typeof value.userId !== 'string' ||
        !value.userId ||
        value.userId.length > MOBILE_LIMITS.userIdLength)) ||
    !Array.isArray(value.events) ||
    value.events.length > MOBILE_LIMITS.maxQueueSize
  )
    return false;
  const ids: string[] = [];
  for (const event of value.events) {
    if (
      !record(event) ||
      event.schema_version !== 1 ||
      !validUuid(event.event_id) ||
      event.installation_id !== value.installationId ||
      !validUuid(event.anonymous_id) ||
      !validEventName(event.name) ||
      typeof event.occurred_at !== 'string' ||
      !Number.isFinite(Date.parse(event.occurred_at)) ||
      !oneOf(event.platform, ['ios', 'android', 'test']) ||
      typeof event.app_version !== 'string' ||
      !event.app_version ||
      event.app_version.length > MOBILE_LIMITS.appVersionLength ||
      (event.user_id !== undefined &&
        (typeof event.user_id !== 'string' ||
          !event.user_id ||
          event.user_id.length > MOBILE_LIMITS.userIdLength)) ||
      !validProperties(event.properties as never) ||
      (event.onboarding !== undefined && !validOnboardingDefinition(event.onboarding))
    )
      return false;
    ids.push(event.event_id);
  }
  if (!uuidUnique(ids)) return false;
  for (const key of ['onboarding', 'paywalls', 'revenuecatIdentity'])
    if (value[key] !== undefined && !record(value[key])) return false;
  if (record(value.onboarding) && !validOnboardingState(value.onboarding)) return false;
  if (record(value.paywalls) && !validPaywallState(value.paywalls)) return false;
  const link = value.revenuecatIdentity;
  if (
    record(link) &&
    (!validProviderId(link.projectId) ||
      !validProviderId(link.appUserId) ||
      !validUuid(link.eventId))
  )
    return false;
  return true;
}
