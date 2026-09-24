import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createReactNativeAnalytics,
  type AnalyticsEvent,
  type OnboardingOptions,
} from '../sdks/react-native/src/index.js';

const definition = (): OnboardingOptions => ({
  id: 'welcome',
  version: 1,
  steps: ['goal'],
  questions: [
    {
      id: 'goal',
      stepId: 'goal',
      title: 'Your goals?',
      type: 'multiple',
      options: [
        { id: 'habit', label: 'Build a habit' },
        { id: 'focus', label: 'Improve focus' },
      ],
    },
  ],
});
describe('answer helper delivery and definitions', () => {
  it('splits large valid question metadata and properties into bounded requests without losing events', async () => {
    const requests: AnalyticsEvent[][] = [],
      bytes: number[] = [];
    const sdk = await createReactNativeAnalytics({
      appId: 'test',
      environment: 'development',
      collectionKey: 'test',
      apiUrl: 'https://local.test',
      platform: 'test',
      appVersion: '1',
      generateId: randomUUID,
      flushIntervalMs: 0,
      batchSize: 100,
      storage: { getItem: async () => null, setItem: async () => {} },
      fetch: async (_url, init) => {
        const body = String(init?.body),
          events = JSON.parse(body).events;
        requests.push(events);
        bytes.push(new TextEncoder().encode(body).length);
        return Response.json({
          accepted: events.map((e: AnalyticsEvent) => e.event_id),
          rejected: [],
        });
      },
    });
    const flow = sdk.onboarding({
      id: 'large',
      steps: ['goal'],
      questions: Array.from({ length: 10 }, (_, q) => ({
        id: `question${q}`,
        stepId: 'goal',
        title: `Question ${q}`,
        type: 'single',
        options: Array.from({ length: 8 }, (_, i) => ({
          id: `option${i}`,
          label: `${i}${'x'.repeat(79)}`,
        })),
      })),
    });
    await flow.start();
    const properties = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [`extra${i}`, 'x'.repeat(1900)]),
    );
    for (let i = 0; i < 80; i++) await flow.step('goal', properties);
    await sdk.flush();
    expect(requests.length).toBeGreaterThan(1);
    expect(bytes.every((n) => n <= 768 * 1024)).toBe(true);
    expect(requests.flat().filter((e) => e.name === 'onboarding_step_viewed')).toHaveLength(80);
    expect(new Set(requests.flat().map((e) => e.event_id)).size).toBe(requests.flat().length);
    expect((await sdk.getStatus()).queued).toBe(0);
    await sdk.dispose();
  });
  it('persists revisions and submissions across restart, snapshots inputs, deduplicates selections and preserves retry IDs', async () => {
    const store = new Map<string, string>(),
      delivered: AnalyticsEvent[] = [],
      diagnostics: string[] = [];
    let offline = true;
    const make = () =>
      createReactNativeAnalytics({
        appId: 'test',
        environment: 'development',
        collectionKey: 'test',
        apiUrl: 'https://local.test',
        platform: 'test',
        appVersion: '1',
        generateId: randomUUID,
        flushIntervalMs: 0,
        storage: {
          getItem: async (k) => store.get(k) ?? null,
          setItem: async (k, v) => {
            store.set(k, v);
          },
        },
        onDiagnostic: (d) => diagnostics.push(d.message),
        fetch: async (_url, init) => {
          if (offline) throw new Error('offline');
          const events = JSON.parse(String(init?.body)).events;
          delivered.push(...events);
          return Response.json({
            accepted: events.map((e: AnalyticsEvent) => e.event_id),
            rejected: [],
          });
        },
      });
    const first = await make(),
      input = definition(),
      flow = first.onboarding(input);
    input.questions![0].title = 'Mutated outside SDK';
    expect(flow.definition.questions![0].title).toBe('Your goals?');
    await flow.start();
    await flow.answer('goal', 'habit'); // Cannot answer unseen step.
    await flow.step('goal');
    const selection = ['habit'];
    const pending = flow.answer('goal', selection);
    selection.push('focus');
    await pending;
    await first.flush();
    await first.dispose();
    const second = await make(),
      resumed = second.onboarding(definition());
    await resumed.start();
    await resumed.answer('goal', 'habit'); // No duplicate after restart.
    await resumed.answer('goal', ['focus', 'habit']);
    await resumed.answer('goal', ['habit', 'focus']);
    await resumed.answer('goal', null);
    await resumed.answer('goal', []);
    await resumed.answer('goal', ['unknown']);
    offline = false;
    await second.resume();
    await second.flush();
    const answers = delivered.filter((e) => e.name === 'onboarding_answered');
    expect(
      answers.map((e) => [
        e.properties.answer_revision,
        e.properties.answer_ids,
        e.properties.answer_status,
      ]),
    ).toEqual([
      [1, ['habit'], 'answered'],
      [2, ['habit', 'focus'], 'answered'],
      [3, [], 'skipped'],
    ]);
    expect(new Set(answers.map((e) => e.properties.attempt_id)).size).toBe(1);
    expect(delivered.filter((e) => e.name === 'onboarding_step_viewed')).toHaveLength(1);
    expect(diagnostics.some((s) => s.includes('before answering'))).toBe(true);
    await resumed.complete();
    await resumed.answer('goal', 'focus');
    await second.flush();
    expect(delivered.filter((e) => e.name === 'onboarding_answered')).toHaveLength(3);
    await second.reset();
    await resumed.start();
    await resumed.step('goal');
    await resumed.answer('goal', 'focus');
    await second.flush();
    const resetAnswer = delivered.filter((e) => e.name === 'onboarding_answered').at(-1)!;
    expect(resetAnswer.properties.answer_revision).toBe(1);
    expect(resetAnswer.anonymous_id).not.toBe(answers[0].anonymous_id);
    await second.setEnabled(false);
    await resumed.answer('goal', 'habit');
    expect((await second.getStatus()).queued).toBe(0);
    await second.dispose();
  });
  it('versions question changes and rejects invalid or conflicting question definitions', async () => {
    const sdk = await createReactNativeAnalytics({
      appId: 'test',
      environment: 'development',
      collectionKey: 'test',
      apiUrl: 'https://local.test',
      platform: 'test',
      appVersion: '1',
      generateId: randomUUID,
      flushIntervalMs: 0,
      storage: { getItem: async () => null, setItem: async () => {} },
      fetch: async (_url, init) =>
        Response.json({
          accepted: JSON.parse(String(init?.body)).events.map((e: AnalyticsEvent) => e.event_id),
          rejected: [],
        }),
    });
    const input = definition();
    delete input.version;
    const a = sdk.onboarding(input).definition.version;
    input.questions![0].options[0].label = 'New wording';
    expect(sdk.onboarding(input).definition.version).not.toBe(a);
    sdk.onboarding(definition());
    expect(() => sdk.onboarding({ ...input, version: 1 })).toThrow('different questions');
    expect(() =>
      sdk.onboarding({
        ...definition(),
        id: 'bad',
        questions: [{ ...definition().questions![0], stepId: 'missing' }],
      }),
    ).toThrow('declared step');
    await sdk.dispose();
  });
});
