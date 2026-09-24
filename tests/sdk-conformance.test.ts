import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eventSchema } from '../packages/contracts/src/index.js';
import { feedbackSubmissionSchema } from '../packages/contracts/src/mobile-feedback.js';
import {
  createReactNativeAnalytics,
  FeedbackError,
  type AnalyticsOptions,
  type AnalyticsEvent,
  type Onboarding,
  type Paywall,
  type PaywallView,
  type PaywallPurchase,
} from '../sdks/react-native/src/index.js';

// Fixtures intentionally contain JSON rather than either SDK's types. The runner
// only adapts public operations; all state transitions belong to the SDK under test.
type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
interface Scenario {
  version: number;
  id: string;
  capability: string;
  config: {
    now: string;
    platform: 'ios';
    appVersion: string;
    maxQueueSize?: number;
    batchSize?: number;
  };
  actions: Record<string, any>[];
  expect: { requests: JSONValue; status: JSONValue; diagnostics: string[] };
}
const folder = fileURLToPath(new URL('../packages/contracts/mobile/scenarios/', import.meta.url));
const scenarios = readdirSync(folder)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(`${folder}/${name}`, 'utf8')) as Scenario);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertJSON(
  actual: unknown,
  expected: JSONValue,
  bindings: Map<string, string>,
  path = '$',
): void {
  if (typeof expected === 'string' && expected.startsWith('$uuid:')) {
    expect(actual, path).toBeTypeOf('string');
    expect(actual, path).toMatch(uuidPattern);
    const bound = bindings.get(expected);
    if (bound) expect(actual, `${path}: ${expected}`).toBe(bound);
    else {
      expect([...bindings.values()], `${path}: distinct semantic IDs`).not.toContain(actual);
      bindings.set(expected, actual as string);
    }
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((value, index) =>
      assertJSON((actual as unknown[])[index], value, bindings, `${path}[${index}]`),
    );
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    expect(actual, path).not.toBeNull();
    expect(typeof actual, path).toBe('object');
    const object = actual as Record<string, unknown>;
    expect(Object.keys(object).sort(), `${path}: keys`).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected))
      assertJSON(object[key], value, bindings, `${path}.${key}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}

describe('mobile behavior contract v1 — React Native public facade', () => {
  it.each(scenarios)('$id ($capability)', async (scenario) => {
    expect(scenario.version).toBe(1);
    let id = 0,
      failSaves = 0;
    let occurrenceTime = new Date(scenario.config.now);
    const store = new Map<string, string>();
    const requests: unknown[] = [],
      diagnostics: string[] = [],
      responses: Record<string, any>[] = [];
    const flows = new Map<string, Onboarding>(),
      walls = new Map<string, Paywall>();
    const views = new Map<string, PaywallView>(),
      purchases = new Map<string, PaywallPurchase>();
    const viewIds = new Map<string, string>(),
      purchaseIds = new Map<string, string>();
    const transport: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      requests.push({ path, body });
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('x-api-key')).toBe('fixture-public-write-only-key');
      if (path === '/v1/events/batch')
        for (const event of body.events)
          expect(eventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
      else expect(feedbackSubmissionSchema.safeParse(body).success).toBe(true);
      const response = responses.shift() ?? { kind: 'ack' };
      if (response.kind === 'offline') throw new Error('Simulated offline transport');
      if (response.kind === 'raw' || response.kind === 'http')
        return Response.json(response.body ?? {}, {
          status: response.status ?? 200,
          headers: response.headers,
        });
      if (path === '/v1/feedback')
        return Response.json({ id: body.id, received_at: scenario.config.now });
      const events = body.events as AnalyticsEvent[];
      return Response.json({
        accepted: (response.accepted ?? events.map((_, index) => index)).map(
          (index: number) => events[index].event_id,
        ),
        rejected: (response.rejected ?? []).map((entry: { index: number; reason: string }) => ({
          event_id: events[entry.index].event_id,
          reason: entry.reason,
        })),
      });
    };
    const options: AnalyticsOptions = {
      appId: 'conformance',
      environment: 'development',
      collectionKey: 'fixture-public-write-only-key',
      apiUrl: 'https://conformance.invalid',
      platform: scenario.config.platform,
      appVersion: scenario.config.appVersion,
      storage: {
        getItem: async (key) => store.get(key) ?? null,
        setItem: async (key, value) => {
          if (failSaves > 0) {
            failSaves--;
            throw new Error('Simulated durable save failure');
          }
          store.set(key, value);
        },
      },
      generateId: () => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}`,
      now: () => occurrenceTime,
      flushIntervalMs: 0,
      appState: { currentState: 'background', addEventListener: () => ({ remove() {} }) },
      maxQueueSize: scenario.config.maxQueueSize,
      batchSize: scenario.config.batchSize,
      fetch: transport,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    };
    let sdk = await createReactNativeAnalytics(options);
    try {
      for (const action of scenario.actions) {
        switch (action.op) {
          case 'track':
            await sdk.track(action.name, action.properties);
            break;
          case 'identify':
            await sdk.identify(action.userId);
            break;
          case 'reset':
            await sdk.reset();
            break;
          case 'setEnabled':
            await sdk.setEnabled(action.enabled);
            break;
          case 'flush':
            await sdk.flush();
            break;
          case 'resume':
            await sdk.resume();
            break;
          case 'network':
            responses.push(action.response);
            break;
          case 'clock.set':
            occurrenceTime = new Date(action.now);
            break;
          case 'storage.failNext':
            failSaves++;
            break;
          case 'restart':
            await sdk.dispose();
            sdk = await createReactNativeAnalytics(options);
            flows.clear();
            walls.clear();
            views.clear();
            purchases.clear();
            break;
          case 'onboarding.define':
            flows.set(action.handle, sdk.onboarding(action.definition));
            break;
          case 'onboarding.start':
            await flows.get(action.handle)!.start(action.properties);
            break;
          case 'onboarding.restart':
            await flows.get(action.handle)!.restart(action.properties);
            break;
          case 'onboarding.step':
            await flows.get(action.handle)!.step(action.stepId, action.properties);
            break;
          case 'onboarding.answer':
            await flows
              .get(action.handle)!
              .answer(action.questionId, action.selection, action.properties);
            break;
          case 'onboarding.complete':
            await flows.get(action.handle)!.complete(action.properties);
            break;
          case 'paywall.define':
            walls.set(action.handle, sdk.paywall({ id: action.id, version: action.version }));
            break;
          case 'paywall.view': {
            const view = await walls.get(action.handle)!.view({
              ...action.options,
              ...(action.onboarding ? { onboarding: flows.get(action.onboarding)! } : {}),
            });
            expect(view).not.toBeNull();
            views.set(action.view, view!);
            viewIds.set(action.view, view!.viewId);
            break;
          }
          case 'paywall.resumeView': {
            const view = await walls.get(action.handle)!.getView(viewIds.get(action.view)!);
            expect(view).not.toBeNull();
            views.set(action.view, view!);
            break;
          }
          case 'paywall.purchase': {
            const purchase = await views.get(action.view)!.purchaseStarted(action.product);
            expect(purchase).not.toBeNull();
            purchases.set(action.purchase, purchase!);
            purchaseIds.set(action.purchase, purchase!.attemptId);
            break;
          }
          case 'paywall.resumePurchase': {
            const purchase = await views
              .get(action.view)!
              .getPurchase(purchaseIds.get(action.purchase)!);
            expect(purchase).not.toBeNull();
            purchases.set(action.purchase, purchase!);
            break;
          }
          case 'paywall.result':
            expect(await purchases.get(action.purchase)!.finished(action.result)).toBe(true);
            break;
          case 'paywall.dismiss':
            expect(await views.get(action.view)!.dismissed({ reason: action.reason })).toBe(true);
            break;
          case 'revenuecat.link':
            expect(
              await sdk.linkRevenueCatUser({
                projectId: action.projectId,
                getAppUserId: async () => action.appUserId,
              }),
            ).toMatch(uuidPattern);
            break;
          case 'feedback.submit': {
            if (action.expectError) {
              try {
                await sdk.feedback(action.input);
                expect.fail('Feedback must reject uncertain delivery');
              } catch (error) {
                expect(error).toBeInstanceOf(FeedbackError);
                expect((error as FeedbackError).code).toBe(action.expectError);
                expect((error as FeedbackError).submissionId).toBe(action.input.submissionId);
              }
            } else {
              const receipt = await sdk.feedback(action.input);
              expect(receipt.id).toBe(action.input.submissionId);
              expect(Number.isFinite(Date.parse(receipt.received_at))).toBe(true);
            }
            break;
          }
          default:
            throw new Error(`Unknown conformance action: ${action.op}`);
        }
      }
      expect(responses, 'Every scripted response must be exercised').toHaveLength(0);
      assertJSON(requests, scenario.expect.requests, new Map());
      const { queued, dropped, enabled, blocked } = await sdk.getStatus();
      assertJSON({ queued, dropped, enabled, blocked }, scenario.expect.status, new Map());
      expect(diagnostics).toEqual(scenario.expect.diagnostics);
    } finally {
      await sdk.dispose();
    }
  });
});
