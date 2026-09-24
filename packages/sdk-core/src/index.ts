import { MOBILE_LIMITS } from '@mobile-analytics/contracts/mobile-constants';
import { jsonBytes, snapshotProperties, validProperties } from './properties.js';
import { acknowledgedIds, retryDelay } from './delivery.js';
import {
  validEventName,
  validLabel,
  validStoredState,
  validUuid,
  validProviderId,
} from './validation.js';
import { FeedbackError, submitFeedback, type FeedbackInput } from './feedback.js';
export { FeedbackError, type FeedbackInput } from './feedback.js';
export type { FeedbackReceipt } from '@mobile-analytics/contracts/types';
import { questions as defineQuestions, type QuestionInput } from './questions.js';
import {
  createPaywall,
  type Paywall,
  type PaywallOptions,
  type PaywallHost,
  type PaywallStore,
} from './paywall.js';
export type {
  Paywall,
  PaywallOptions,
  PaywallViewOptions,
  PaywallView,
  PaywallProduct,
  PaywallPurchase,
  PurchaseResult,
} from './paywall.js';
import type {
  AnalyticsEvent,
  BatchResult,
  Properties,
  OnboardingDefinition,
} from '@mobile-analytics/contracts/types';
export type {
  AnalyticsEvent,
  Properties,
  OnboardingDefinition,
  OnboardingQuestion,
} from '@mobile-analytics/contracts/types';

export interface RevenueCatIdentityOptions {
  /** RevenueCat project ID, not its public SDK key or secret API key. */
  projectId: string;
  /** Called after capturing analytics identity. Pass () => Purchases.getAppUserID(). */
  getAppUserId: () => Promise<string>;
}
export interface OnboardingOptions {
  id: string;
  /** Positive safe integer (1, 2, …). String labels remain supported; omit for automatic versioning. */
  version?: number | string;
  steps: readonly string[];
  questions?: readonly QuestionInput[];
}
export interface OnboardingAttempt {
  attemptId: string;
  completed: boolean;
  nextStep: number;
}
export interface Onboarding {
  readonly definition: Readonly<Omit<OnboardingDefinition, 'steps'> & { steps: readonly string[] }>;
  /** Starts once, or resumes the persisted attempt (including a completed attempt). */
  start(properties?: Properties): Promise<string | null>;
  /** Explicitly begins a new attempt, for an actual restart of onboarding. */
  restart(properties?: Properties): Promise<string | null>;
  step(id: string, properties?: Properties): Promise<void>;
  /** Submit an option or option list; null records an explicit skip. */
  answer(
    questionId: string,
    selection: string | readonly string[] | null,
    properties?: Properties,
  ): Promise<void>;
  complete(properties?: Properties): Promise<void>;
  getState(): Promise<OnboardingAttempt | null>;
}
// Stable non-security fingerprint. The server compares the full ordered definition,
// so even a fingerprint collision cannot overwrite an existing version.
function automaticVersion(steps: readonly string[], questions: OnboardingDefinition['questions']) {
  let a = 0x811c9dc5,
    b = 0x9e3779b9;
  for (const char of JSON.stringify(questions?.length ? { steps, questions } : steps)) {
    a = Math.imul(a ^ char.charCodeAt(0), 0x01000193);
    b = Math.imul(b ^ char.charCodeAt(0), 0x85ebca6b);
  }
  return `auto-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface AppStateAdapter {
  readonly currentState?: string | null;
  addEventListener(event: 'change', listener: (state: string) => void): { remove(): void };
}
export interface NetworkAdapter {
  addEventListener(listener: (state: { isConnected: boolean | null }) => void): () => void;
}
export interface Diagnostic {
  code:
    | 'configuration'
    | 'storage'
    | 'invalid_event'
    | 'queue_full'
    | 'network'
    | 'rejected'
    | 'blocked';
  message: string;
  eventId?: string;
}
export interface AnalyticsOptions {
  /** Needed only for legacy collection keys. New keys contain their storage namespace. */
  appId?: string;
  environment?: 'development' | 'production';
  apiUrl: string;
  collectionKey: string;
  platform: 'ios' | 'android' | 'test';
  appVersion: string;
  storage: StorageAdapter;
  generateId: () => string;
  /** Pass React Native's AppState for automatic app-open tracking. Missing on iOS/Android emits a configuration warning. */
  appState?: AppStateAdapter;
  networkInfo?: NetworkAdapter;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  batchSize?: number;
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
}
interface State {
  version: 1;
  installationId: string;
  anonymousId: string;
  userId?: string;
  enabled: boolean;
  events: AnalyticsEvent[];
  dropped: number;
  onboarding?: Record<
    string,
    OnboardingAttempt & {
      definition: OnboardingDefinition;
      answers?: Record<string, { values: string[] | null; revision: number }>;
    }
  >;
  paywalls?: PaywallStore;
  revenuecatIdentity?: { projectId: string; appUserId: string; eventId: string };
}

export class Analytics {
  private state!: State;
  private serial: Promise<unknown> = Promise.resolve();
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cleanup: (() => void)[] = [];
  private disposed = false;
  private blocked = false;
  private failures = 0;
  private retryAt = 0;
  private serverRetryAt = 0;
  private activeController: AbortController | undefined;
  private readonly key: string;
  private readonly clock: () => Date;
  private readonly transport: typeof fetch;
  private readonly batchSize: number;
  private readonly capacity: number;
  private identityRevision = 0;
  private definitions = new Map<string, OnboardingDefinition>();
  private onboardingHandles = new WeakSet<object>();

  private constructor(private readonly options: AnalyticsOptions) {
    // Callers may reuse or mutate their configuration object after initialization.
    this.options = Object.freeze({ ...options });
    let endpoint: URL;
    try {
      endpoint = new URL(options.apiUrl);
    } catch {
      throw new Error('Analytics requires an absolute HTTP(S) API URL');
    }
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error('Use an HTTP(S) API URL without credentials, query or fragment');
    if (
      typeof options.collectionKey !== 'string' ||
      !options.collectionKey.trim() ||
      typeof options.appVersion !== 'string' ||
      !options.appVersion ||
      options.appVersion.length > MOBILE_LIMITS.appVersionLength ||
      !['ios', 'android', 'test'].includes(options.platform) ||
      typeof options.storage?.getItem !== 'function' ||
      typeof options.storage?.setItem !== 'function' ||
      typeof options.generateId !== 'function'
    )
      throw new Error('Invalid analytics configuration');
    for (const [name, value] of Object.entries({
      maxQueueSize: options.maxQueueSize,
      batchSize: options.batchSize,
      requestTimeoutMs: options.requestTimeoutMs,
    }))
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
        throw new Error(`${name} must be a positive safe integer`);
    if (
      (options.maxQueueSize ?? 0) > MOBILE_LIMITS.maxQueueSize ||
      (options.requestTimeoutMs ?? 0) > MOBILE_LIMITS.maxRequestTimeoutMs
    )
      throw new Error('Queue size or request timeout exceeds the supported maximum');
    if (
      options.flushIntervalMs !== undefined &&
      (!Number.isSafeInteger(options.flushIntervalMs) ||
        options.flushIntervalMs < 0 ||
        options.flushIntervalMs > MOBILE_LIMITS.maxFlushIntervalMs)
    )
      throw new Error('flushIntervalMs must be a nonnegative safe integer');
    const parts =
      /^ma_(dev|prod)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_[0-9a-f]{48}$/.exec(
        options.collectionKey,
      );
    const appId = parts?.[2] ?? options.appId;
    const environment = parts
      ? parts[1] === 'prod'
        ? 'production'
        : 'development'
      : options.environment;
    if (!appId || !['development', 'production'].includes(environment ?? ''))
      throw new Error(
        'Legacy keys require appId and environment; copy the full saved configuration',
      );
    if (
      parts &&
      ((options.appId && options.appId !== appId) ||
        (options.environment && options.environment !== environment))
    )
      throw new Error('Collection key does not match the configured app/environment');
    this.key = `mobile-analytics:v1:${appId}:${environment}`;
    this.clock = options.now ?? (() => new Date());
    this.transport = options.fetch ?? globalThis.fetch;
    this.batchSize = Math.max(
      1,
      Math.min(options.batchSize ?? MOBILE_LIMITS.defaultBatchSize, MOBILE_LIMITS.batchEvents),
    );
    this.capacity = Math.max(1, options.maxQueueSize ?? MOBILE_LIMITS.defaultQueueSize);
    if (!/^https:\/\//.test(options.apiUrl) && environment === 'production')
      throw new Error('Production analytics requires HTTPS');
  }

  static async create(options: AnalyticsOptions): Promise<Analytics> {
    const client = new Analytics(options);
    options = client.options;
    const stored = await client.options.storage.getItem(client.key);
    if (stored) {
      const parsed = JSON.parse(stored) as State;
      if (!validStoredState(parsed))
        throw new Error('Unsupported analytics storage; do not overwrite without a migration');
      client.state = parsed;
    } else {
      client.state = {
        version: 1,
        installationId: client.nextId(),
        anonymousId: client.nextId(),
        enabled: true,
        events: [],
        dropped: 0,
      };
      if (client.state.installationId.toLowerCase() === client.state.anonymousId.toLowerCase())
        throw new Error('generateId must return distinct identity UUIDs');
      client.state.events.push(client.event('app_first_open', {}));
      await options.storage.setItem(client.key, JSON.stringify(client.state));
    }
    const interval = options.flushIntervalMs ?? MOBILE_LIMITS.defaultFlushIntervalMs;
    if (interval > 0)
      client.timer = setInterval(() => {
        void client.flush();
      }, interval);
    if (options.appState) {
      const subscription = options.appState.addEventListener('change', (state) => {
        if (state === 'active') void client.track('app_active').then(() => client.flush());
      });
      client.cleanup.push(() => subscription.remove());
      // A cold launch may already be active before the listener is installed.
      if (options.appState.currentState === 'active') await client.track('app_active');
    } else if (options.platform !== 'test') {
      const diagnostic: Diagnostic = {
        code: 'configuration',
        message:
          'Automatic app-open tracking is unavailable. Import AppState from react-native and pass appState: AppState to createReactNativeAnalytics. First-open and explicit events still work, but repeat app opens will be missing. Do not manually track app_active.',
      };
      if (!client.diagnose(diagnostic)) {
        try {
          console.warn(`[Appbase] ${diagnostic.message}`);
        } catch {
          // Even a broken logger must not stop the app or other analytics.
        }
      }
    }
    if (options.networkInfo)
      client.cleanup.push(
        options.networkInfo.addEventListener((state) => {
          if (state.isConnected) {
            client.retryAt = 0;
            void client.flush();
          }
        }),
      );
    return client;
  }

  private diagnose(d: Diagnostic): boolean {
    try {
      if (this.options.onDiagnostic) {
        this.options.onDiagnostic(d);
        return true;
      }
    } catch {
      /* Diagnostics cannot break event delivery. */
    }
    return false;
  }
  private async update<T>(operation: () => T | Promise<T>, persist = false): Promise<T> {
    const result = this.serial.then(async () => {
      const before = persist ? JSON.stringify(this.state) : '';
      try {
        const result = await operation();
        if (persist) await this.options.storage.setItem(this.key, JSON.stringify(this.state));
        return result;
      } catch (error) {
        if (persist) this.state = JSON.parse(before) as State;
        throw error;
      }
    });
    this.serial = result.catch(() => {});
    return result;
  }
  private event(
    name: string,
    properties: Properties,
    occurredAt = this.clock().toISOString(),
  ): AnalyticsEvent {
    return {
      schema_version: 1,
      event_id: this.nextId(),
      installation_id: this.state.installationId,
      anonymous_id: this.state.anonymousId,
      ...(this.state.userId ? { user_id: this.state.userId } : {}),
      name,
      occurred_at: occurredAt,
      platform: this.options.platform,
      app_version: this.options.appVersion,
      properties: snapshotProperties(properties),
    };
  }
  private nextId(): string {
    const id = this.options.generateId();
    if (
      !validUuid(id) ||
      this.state?.events.some((event) => event.event_id.toLowerCase() === id.toLowerCase())
    )
      throw new Error('generateId must return a fresh UUID');
    return id;
  }
  private enqueue(event: AnalyticsEvent) {
    if (this.state.events.length >= this.capacity) {
      this.state.dropped++;
      this.diagnose({
        code: 'queue_full',
        message: 'Queue is full; newest event was not recorded',
        eventId: event.event_id,
      });
      return false;
    }
    this.state.events.push(event);
    return true;
  }
  async track(name: string, properties: Properties = {}): Promise<void> {
    if (this.disposed) return;
    if (!validEventName(name) || !validProperties(properties)) {
      this.diagnose({
        code: 'invalid_event',
        message: 'Use a valid event name and flat properties',
      });
      return;
    }
    try {
      const occurredAt = this.clock().toISOString();
      const snapshot = snapshotProperties(properties);
      await this.update(() => {
        if (this.state.enabled) this.enqueue(this.event(name, snapshot, occurredAt));
      }, true);
      if (this.state.events.length >= this.batchSize) void this.flush();
    } catch {
      this.diagnose({ code: 'storage', message: 'Could not persist event' });
    }
  }
  /** Explicit user contact. Resolves only after server storage, independently of analytics consent. */
  async feedback(input: FeedbackInput) {
    if (this.disposed)
      throw new FeedbackError(
        'This client has been disposed.',
        input.submissionId ?? '',
        'configuration',
      );
    const identity = await this.update(() =>
      this.state.enabled
        ? {
            anonymous_id: this.state.anonymousId,
            ...(this.state.userId ? { user_id: this.state.userId } : {}),
          }
        : {},
    );
    return submitFeedback(
      input,
      {
        platform: this.options.platform,
        app_version: this.options.appVersion,
        ...identity,
      },
      {
        generateId: this.options.generateId,
        fetch: this.transport,
        apiUrl: this.options.apiUrl,
        collectionKey: this.options.collectionKey,
        timeout: this.options.requestTimeoutMs ?? MOBILE_LIMITS.defaultRequestTimeoutMs,
      },
    );
  }
  /** Durable client identity evidence; never grants access or verifies a purchase. */
  async linkRevenueCatUser(options: RevenueCatIdentityOptions): Promise<string | null> {
    const projectId = options?.projectId;
    const lookup = options?.getAppUserId;
    if (!validProviderId(projectId) || typeof lookup !== 'function') {
      this.diagnose({
        code: 'invalid_event',
        message: 'Supply a RevenueCat project ID and an ID lookup callback',
      });
      return null;
    }
    const revision = await this.update(() =>
      this.disposed || !this.state.enabled ? null : this.identityRevision,
    );
    if (revision === null) return null;
    let appUserId: string;
    try {
      appUserId = await lookup();
    } catch {
      this.diagnose({
        code: 'invalid_event',
        message: 'RevenueCat identity lookup failed; retry after configuration',
      });
      return null;
    }
    if (!validProviderId(appUserId)) {
      this.diagnose({
        code: 'invalid_event',
        message: 'RevenueCat App User ID must be an opaque 1–255 character identifier',
      });
      return null;
    }
    try {
      const eventId = await this.update(() => {
        if (this.disposed || !this.state.enabled || revision !== this.identityRevision) {
          this.diagnose({
            code: 'invalid_event',
            message:
              'Analytics identity changed during RevenueCat lookup; link again after the account change',
          });
          return null;
        }
        const previous = this.state.revenuecatIdentity;
        if (previous?.projectId === projectId && previous.appUserId === appUserId)
          return previous.eventId;
        const event = this.event('revenuecat_identity_linked', {
          revenuecat_project_id: projectId,
          revenuecat_app_user_id: appUserId,
          link_source: 'client',
        });
        if (!this.enqueue(event)) return null;
        this.state.revenuecatIdentity = { projectId, appUserId, eventId: event.event_id };
        return event.event_id;
      }, true);
      if (this.state.events.length >= this.batchSize) void this.flush();
      return eventId;
    } catch {
      this.diagnose({ code: 'storage', message: 'Could not persist RevenueCat identity link' });
      return null;
    }
  }

  paywall(options: PaywallOptions): Paywall {
    const perform: PaywallHost['perform'] = async (operation) => {
      if (this.disposed) return null;
      const occurredAt = this.clock().toISOString();
      try {
        const result = await this.update(() => {
          if (!this.state.enabled) return null;
          return operation(
            (this.state.paywalls ??= {}),
            (name, properties) => {
              if (!validProperties(properties))
                throw new Error('Use valid bounded paywall properties');
              return this.enqueue(this.event(name, properties, occurredAt));
            },
            (id, version) => this.state.onboarding?.[`${id}/${version}`]?.attemptId,
          );
        }, true);
        if (this.state.events.length >= this.batchSize) void this.flush();
        return result;
      } catch (error) {
        this.diagnose({
          code: 'invalid_event',
          message: error instanceof Error ? error.message : 'Could not persist paywall event',
        });
        return null;
      }
    };
    return createPaywall(options, {
      generateId: this.options.generateId,
      perform,
      ownsOnboarding: (handle) => this.onboardingHandles.has(handle),
    });
  }
  onboarding(options: OnboardingOptions): Onboarding {
    if (!options || typeof options !== 'object' || !Array.isArray(options.steps))
      throw new Error('Onboarding requires a definition with declared steps');
    const version = options.version;
    if (
      version !== undefined &&
      typeof version !== 'string' &&
      (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1)
    )
      throw new Error(
        'Onboarding version must be a positive safe integer or a stable string label',
      );
    const questions = defineQuestions(options.questions ?? [], options.steps);
    const definition: OnboardingDefinition = {
      id: options.id,
      version: version === undefined ? automaticVersion(options.steps, questions) : String(version),
      steps: [...options.steps],
      ...(questions.length ? { questions } : {}),
    };
    if (
      !validLabel(definition.id) ||
      !validLabel(definition.version) ||
      definition.steps.length < 1 ||
      definition.steps.length > MOBILE_LIMITS.onboardingSteps ||
      definition.steps.some((step) => !validLabel(step)) ||
      new Set(definition.steps).size !== definition.steps.length
    )
      throw new Error('Onboarding requires stable ID/version labels and 1–20 unique step IDs');
    if (jsonBytes(definition) > MOBILE_LIMITS.onboardingDefinitionBytes)
      throw new Error('Onboarding definition exceeds 16 KiB');
    const key = `${definition.id}/${definition.version}`;
    const previous = this.definitions.get(key) ?? this.state.onboarding?.[key]?.definition;
    if (previous && JSON.stringify(previous.steps) !== JSON.stringify(definition.steps))
      throw new Error('This onboarding version already has different steps; choose a new version');
    if (previous && JSON.stringify(previous.questions ?? []) !== JSON.stringify(questions))
      throw new Error(
        'This onboarding version already has different questions; choose a new version',
      );
    if (!this.definitions.has(key) && this.definitions.size >= MOBILE_LIMITS.onboardingDefinitions)
      throw new Error('At most 100 onboarding definitions per SDK instance');
    this.definitions.set(key, definition);
    const act = async (
      kind: 'start' | 'restart' | 'step' | 'complete' | 'answer',
      properties: Properties = {},
      stepId?: string,
      answer?: { questionId: string; selection: string[] | null },
    ): Promise<string | null> => {
      if (this.disposed) return null;
      try {
        if (!validProperties(properties)) throw new Error('Use valid flat onboarding properties');
        const occurredAt = this.clock().toISOString();
        const snapshot = snapshotProperties(properties);
        const result = await this.update(() => {
          if (!this.state.enabled) return null;
          const attempts = (this.state.onboarding ??= {});
          let attempt = attempts[key];
          if (kind === 'start' && attempt) return attempt.attemptId;
          if (kind === 'start' || kind === 'restart') {
            if (!attempt && Object.keys(attempts).length >= MOBILE_LIMITS.onboardingDefinitions)
              throw new Error('Onboarding attempt storage limit reached');
            const attemptId = this.nextId();
            if (
              Object.values(attempts).some(
                (saved) => saved.attemptId.toLowerCase() === attemptId.toLowerCase(),
              )
            )
              throw new Error('generateId returned an existing onboarding attempt ID');
            attempt = {
              attemptId,
              completed: false,
              nextStep: 0,
              definition,
            };
          } else {
            if (!attempt)
              throw new Error('Call onboarding.start() before tracking a step or completion');
            if (attempt.completed) return attempt.attemptId;
            if (
              kind === 'step' &&
              (!stepId ||
                !definition.steps.includes(stepId) ||
                definition.steps.indexOf(stepId) > attempt.nextStep)
            )
              throw new Error('Track the declared onboarding steps in order');
            if (kind === 'complete' && attempt.nextStep !== definition.steps.length)
              throw new Error('Track every onboarding step before completion');
          }
          let answerState: { values: string[] | null; revision: number } | undefined;
          let answerProps: Properties = {};
          if (kind === 'answer' && answer) {
            const question = questions.find((q) => q.id === answer.questionId);
            if (!question || definition.steps.indexOf(question.stepId) >= attempt.nextStep)
              throw new Error('View the question’s declared step before answering');
            const ids = answer.selection;
            if (
              ids !== null &&
              (ids.length === 0 ||
                new Set(ids).size !== ids.length ||
                (question.type === 'single' && ids.length !== 1) ||
                ids.some((id) => !question.options.some((o) => o.id === id)))
            )
              throw new Error('Choose valid question options, or null to explicitly skip');
            const values =
              ids === null
                ? null
                : question.options.filter((o) => ids.includes(o.id)).map((o) => o.id);
            const prior = attempt.answers?.[question.id];
            if (prior && JSON.stringify(prior.values) === JSON.stringify(values))
              return attempt.attemptId;
            const revision = (prior?.revision ?? 0) + 1;
            if (!Number.isSafeInteger(revision)) throw new Error('Answer revision limit reached');
            answerState = { values, revision };
            answerProps = {
              step_id: question.stepId,
              question_id: question.id,
              answer_ids: values ?? [],
              answer_status: values === null ? 'skipped' : 'answered',
              answer_revision: revision,
            };
          }
          const props = {
            ...snapshot,
            flow_id: definition.id,
            flow_version: definition.version,
            attempt_id: attempt.attemptId,
            ...(kind === 'step' ? { step_id: stepId! } : {}),
            ...answerProps,
          };
          if (!validProperties(props)) throw new Error('Use valid flat properties for onboarding');
          const name =
            kind === 'start' || kind === 'restart'
              ? 'onboarding_started'
              : kind === 'step'
                ? 'onboarding_step_viewed'
                : kind === 'answer'
                  ? 'onboarding_answered'
                  : 'onboarding_completed';
          if (
            !this.enqueue({
              ...this.event(name, props, occurredAt),
              onboarding: { ...definition, steps: [...definition.steps] },
            })
          )
            return null;
          if (kind === 'step' && definition.steps[attempt.nextStep] === stepId) attempt.nextStep++;
          if (kind === 'complete') attempt.completed = true;
          if (answerState && answer) (attempt.answers ??= {})[answer.questionId] = answerState;
          attempts[key] = attempt;
          return attempt.attemptId;
        }, true);
        if (this.state.events.length >= this.batchSize) void this.flush();
        return result;
      } catch (error) {
        this.diagnose({
          code: 'invalid_event',
          message: error instanceof Error ? error.message : 'Could not persist onboarding event',
        });
        return null;
      }
    };
    // Public definitions and event metadata must not drift after registration.
    for (const question of questions) {
      question.options.forEach(Object.freeze);
      Object.freeze(question.options);
      Object.freeze(question);
    }
    Object.freeze(questions);
    const handle: Onboarding = {
      definition: Object.freeze({ ...definition, steps: Object.freeze([...definition.steps]) }),
      start: (properties) => act('start', properties),
      restart: (properties) => act('restart', properties),
      step: async (id, properties) => {
        await act('step', properties, id);
      },
      answer: async (questionId, selection, properties) => {
        if (
          typeof questionId !== 'string' ||
          !(
            selection === null ||
            typeof selection === 'string' ||
            (Array.isArray(selection) && selection.every((value) => typeof value === 'string'))
          )
        ) {
          this.diagnose({
            code: 'invalid_event',
            message: 'Choose an option, a string option list, or null to skip',
          });
          return;
        }
        await act('answer', properties, undefined, {
          questionId,
          selection:
            selection === null
              ? null
              : typeof selection === 'string'
                ? [selection]
                : [...selection],
        });
      },
      complete: async (properties) => {
        await act('complete', properties);
      },
      getState: () =>
        this.update(() => {
          const attempt = this.state.onboarding?.[key];
          return attempt
            ? {
                attemptId: attempt.attemptId,
                completed: attempt.completed,
                nextStep: attempt.nextStep,
              }
            : null;
        }),
    };
    this.onboardingHandles.add(handle);
    return handle;
  }
  async identify(userId: string): Promise<void> {
    if (this.disposed) return;
    if (typeof userId !== 'string' || !userId || userId.length > MOBILE_LIMITS.userIdLength) {
      this.diagnose({
        code: 'invalid_event',
        message: 'Use an opaque user ID of 1–200 characters',
      });
      return;
    }
    try {
      await this.update(() => {
        if (this.state.userId && this.state.userId !== userId)
          throw new Error('Call reset before switching accounts');
        if (this.state.userId !== userId) {
          this.identityRevision++;
          delete this.state.revenuecatIdentity;
        }
        this.state.userId = userId;
        if (this.state.enabled) this.enqueue(this.event('identity_linked', {}));
      }, true);
    } catch (error) {
      this.diagnose({
        code: 'storage',
        message: error instanceof Error ? error.message : 'Could not persist identity',
      });
    }
  }
  async reset(): Promise<void> {
    if (this.disposed) return;
    await this.update(() => {
      const anonymousId = this.nextId();
      if (
        [
          this.state.anonymousId,
          this.state.installationId,
          ...this.state.events.map((e) => e.anonymous_id),
        ].some((id) => id.toLowerCase() === anonymousId.toLowerCase())
      )
        throw new Error('reset requires a new anonymous UUID');
      this.identityRevision++;
      delete this.state.revenuecatIdentity;
      this.state.anonymousId = anonymousId;
      delete this.state.userId;
      this.state.onboarding = {};
      this.state.paywalls = {};
    }, true);
  }
  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return;
    if (typeof enabled !== 'boolean') {
      this.diagnose({ code: 'invalid_event', message: 'Collection enabled must be a boolean' });
      return;
    }
    if (!enabled) this.activeController?.abort();
    await this.update(() => {
      if (this.state.enabled !== enabled) this.identityRevision++;
      this.state.enabled = enabled;
      if (!enabled) {
        delete this.state.revenuecatIdentity;
        this.state.events = [];
        this.state.onboarding = {};
        this.state.paywalls = {};
      }
    }, true);
  }
  async getIdentity() {
    return this.update(() => ({
      installationId: this.state.installationId,
      anonymousId: this.state.anonymousId,
      userId: this.state.userId,
    }));
  }
  async getStatus() {
    return this.update(() => ({
      queued: this.state.events.length,
      dropped: this.state.dropped,
      enabled: this.state.enabled,
      blocked: this.blocked,
      retryAt: Math.max(this.retryAt, this.serverRetryAt),
    }));
  }
  /** Retry after correcting credentials/configuration. Does not modify queued events. */
  resume() {
    this.blocked = false;
    this.retryAt = 0;
    return this.flush();
  }
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.disposed || this.blocked || Date.now() < Math.max(this.retryAt, this.serverRetryAt))
      return Promise.resolve();
    this.inFlight = this.deliver()
      .catch(() => {
        this.diagnose({
          code: 'storage',
          message: 'Could not update persistent queue; acknowledged events may be retried safely',
        });
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
  private async deliver() {
    for (let batchNumber = 0; batchNumber < MOBILE_LIMITS.maxBatchesPerFlush; batchNumber++) {
      const batch = await this.update(() => {
        if (!this.state.enabled) return [];
        const batch: AnalyticsEvent[] = [];
        let bytes = 14; // JSON envelope plus separators; stay below the API's 1 MiB limit.
        for (const event of this.state.events.slice(0, this.batchSize)) {
          const size = jsonBytes(event) + 1;
          if (batch.length && bytes + size > MOBILE_LIMITS.clientBatchBytes) break;
          batch.push(event);
          bytes += size;
        }
        return batch;
      });
      if (!batch.length || this.disposed) return;
      const controller = new AbortController();
      this.activeController = controller;
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.requestTimeoutMs ?? MOBILE_LIMITS.defaultRequestTimeoutMs,
      );
      try {
        const response = await this.transport(
          `${this.options.apiUrl.replace(/\/$/, '')}/v1/events/batch`,
          {
            method: 'POST',
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': this.options.collectionKey,
            },
            body: JSON.stringify({ events: batch }),
            signal: controller.signal,
          },
        );
        if (response.status === 429 || response.status >= 500) {
          const delay = retryDelay(response.headers.get('retry-after'), Date.now());
          if (response.status === 429) {
            this.serverRetryAt = Date.now() + delay;
            this.diagnose({
              code: 'network',
              message:
                'HTTP 429: ingestion limit reached; queued events will retry after the limit resets',
            });
          }
          this.backoff(delay);
          return;
        }
        if (!response.ok) {
          this.blocked = true;
          this.diagnose({
            code: 'blocked',
            message: `Collection rejected with HTTP ${response.status}; fix configuration then resume`,
          });
          return;
        }
        const raw: unknown = await response.json();
        const ids = new Set(batch.map((e) => e.event_id));
        const removed = acknowledgedIds(raw, ids);
        const ack = raw as BatchResult;
        try {
          await this.update(() => {
            this.state.events = this.state.events.filter((e) => !removed.has(e.event_id));
          }, true);
        } catch {
          this.diagnose({
            code: 'storage',
            message: 'Could not save acknowledgement; events remain queued for safe retry',
          });
          this.backoff();
          return;
        }
        for (const rejected of ack.rejected)
          this.diagnose({
            code: 'rejected',
            message: rejected.reason,
            eventId: rejected.event_id ?? undefined,
          });
        this.failures = 0;
        this.retryAt = 0;
      } catch {
        this.backoff();
        return;
      } finally {
        clearTimeout(timeout);
        this.activeController = undefined;
      }
    }
  }
  private backoff(minimum = 0) {
    this.failures++;
    this.retryAt =
      Date.now() +
      Math.max(
        minimum,
        Math.min(MOBILE_LIMITS.retryMaximumMs, 1000 * 2 ** Math.min(this.failures, 6)),
      );
    this.diagnose({
      code: 'network',
      message: 'Delivery deferred; events remain in persistent storage',
    });
  }
  async dispose() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    for (const remove of this.cleanup) remove();
    this.activeController?.abort();
    await this.inFlight;
    await this.serial;
  }
}
export const createAnalytics = (options: AnalyticsOptions) => Analytics.create(options);
