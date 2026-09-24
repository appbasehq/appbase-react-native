import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createReactNativeAnalytics,
  type AnalyticsOptions,
  type AnalyticsEvent,
} from '../sdks/react-native/src/index.js';

function fixture(overrides: Partial<AnalyticsOptions> = {}) {
  const data = new Map<string, string>();
  const onDiagnostic = vi.fn();
  const options: AnalyticsOptions = {
    apiUrl: 'https://analytics.example',
    collectionKey: 'legacy-key',
    appId: randomUUID(),
    environment: 'development',
    platform: 'test',
    appVersion: '1',
    generateId: randomUUID,
    flushIntervalMs: 0,
    onDiagnostic,
    storage: {
      getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => {
        data.set(key, value);
      },
    },
    ...overrides,
  };
  return { options, data, onDiagnostic };
}
const events = (init?: RequestInit): AnalyticsEvent[] => JSON.parse(String(init?.body)).events;
const acknowledge = (batch: AnalyticsEvent[]) =>
  Response.json({ accepted: batch.map((e) => e.event_id), rejected: [] });

describe('SDK configuration and durable delivery boundaries', () => {
  it.each([
    { maxQueueSize: NaN },
    { batchSize: 1.5 },
    { requestTimeoutMs: 0 },
    { flushIntervalMs: -1 },
    { apiUrl: 'file:///tmp/events' },
    { apiUrl: 'https://user:password@example.com' },
    { apiUrl: 'https://example.com?token=bad' },
    { appVersion: '' },
  ])('rejects invalid configuration before writing installation state: %j', async (override) => {
    const f = fixture(override);
    await expect(createReactNativeAnalytics(f.options)).rejects.toThrow();
    expect(f.data.size).toBe(0);
  });

  it('snapshots configuration so later caller mutation cannot redirect collection', async () => {
    const transport = vi.fn(async (_url, init) => acknowledge(events(init)));
    const f = fixture({ fetch: transport });
    const sdk = await createReactNativeAnalytics(f.options);
    f.options.apiUrl = 'https://different.example';
    f.options.collectionKey = 'different-key';
    await sdk.flush();
    expect(transport.mock.calls[0][0]).toBe('https://analytics.example/v1/events/batch');
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ 'X-API-Key': 'legacy-key' });
    await sdk.dispose();
  });

  it('diagnoses invalid runtime arguments without queueing malformed events or identity', async () => {
    const f = fixture();
    const sdk = await createReactNativeAnalytics(f.options);
    await sdk.track('feature_used', null as never);
    await sdk.track('feature_used', [] as never);
    await sdk.identify(42 as never);
    expect((await sdk.getStatus()).queued).toBe(1);
    expect((await sdk.getIdentity()).userId).toBeUndefined();
    expect(f.onDiagnostic.mock.calls.map(([d]) => d.code)).toEqual([
      'invalid_event',
      'invalid_event',
      'invalid_event',
    ]);
    await sdk.dispose();
  });

  it.each(['duplicate', 'conflict', 'foreign', 'null', 'empty'])(
    'retains pending events for an ambiguous %s receipt',
    async (kind) => {
      const f = fixture({
        fetch: async (_url, init) => {
          const id = events(init)[0].event_id;
          return Response.json(
            kind === 'null'
              ? null
              : {
                  accepted:
                    kind === 'duplicate'
                      ? [id, id]
                      : kind === 'foreign'
                        ? [randomUUID()]
                        : kind === 'empty'
                          ? []
                          : [id],
                  rejected: kind === 'conflict' ? [{ event_id: id, reason: 'contradictory' }] : [],
                },
          );
        },
      });
      const sdk = await createReactNativeAnalytics(f.options);
      await sdk.flush();
      expect((await sdk.getStatus()).queued).toBe(1);
      expect(f.onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'network' }));
      await sdk.dispose();
    },
  );

  it('removes only acknowledged events and retains the unacknowledged subset on interruption', async () => {
    let calls = 0;
    const f = fixture({
      fetch: async (_url, init) => {
        if (++calls > 1) throw new Error('offline');
        return acknowledge(events(init).slice(0, 1));
      },
    });
    const sdk = await createReactNativeAnalytics(f.options);
    await sdk.track('workout_completed');
    await sdk.flush();
    expect((await sdk.getStatus()).queued).toBe(1);
    expect(JSON.parse([...f.data.values()][0]).events[0].name).toBe('workout_completed');
    await sdk.dispose();
  });

  it('retains acknowledged events when saving the receipt fails and diagnoses storage', async () => {
    const f = fixture();
    const save = f.options.storage.setItem;
    let failing = false;
    f.options.storage.setItem = async (key, value) => {
      if (failing) throw new Error('disk');
      await save(key, value);
    };
    f.options.fetch = async (_url, init) => {
      failing = true;
      return acknowledge(events(init));
    };
    const sdk = await createReactNativeAnalytics(f.options);
    await sdk.flush();
    expect((await sdk.getStatus()).queued).toBe(1);
    expect(f.onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'storage' }));
    failing = false;
    await sdk.dispose();
  });

  it('honors an HTTP-date Retry-After despite explicit resume', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async (_url, init) =>
      transport.mock.calls.length === 1
        ? new Response('{}', {
            status: 429,
            headers: { 'Retry-After': new Date(Date.now() + 60000).toUTCString() },
          })
        : acknowledge(events(init)),
    );
    const sdk = await createReactNativeAnalytics(fixture({ fetch: transport }).options);
    try {
      await sdk.flush();
      await sdk.resume();
      expect(transport).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60000);
      await sdk.flush();
      expect((await sdk.getStatus()).queued).toBe(0);
    } finally {
      await sdk.dispose();
      vi.useRealTimers();
    }
  });

  it('refuses a foreign onboarding helper even with matching flow IDs and versions', async () => {
    const a = await createReactNativeAnalytics(fixture().options);
    const b = await createReactNativeAnalytics(fixture().options);
    const foreign = a.onboarding({ id: 'main', version: 1, steps: ['intro'] });
    const local = b.onboarding({ id: 'main', version: 1, steps: ['intro'] });
    await foreign.start();
    await local.start();
    expect(
      await b.paywall({ id: 'upgrade' }).view({ placement: 'onboarding', onboarding: foreign }),
    ).toBeNull();
    expect(
      await b.paywall({ id: 'upgrade' }).view({ placement: 'onboarding', onboarding: local }),
    ).not.toBeNull();
    await a.dispose();
    await b.dispose();
  });
  it('rejects corrupt persisted state without replacing saved data or identity', async () => {
    const f = fixture();
    const first = await createReactNativeAnalytics(f.options);
    await first.dispose();
    const [key, raw] = [...f.data.entries()][0];
    const state = JSON.parse(raw);
    state.events[0].properties = { invalid: { nested: true } };
    const corrupt = JSON.stringify(state);
    f.data.set(key, corrupt);
    await expect(createReactNativeAnalytics(f.options)).rejects.toThrow();
    expect(f.data.get(key)).toBe(corrupt);
  });

  it('rejects exact-label trailing newlines in events and workflows', async () => {
    const f = fixture();
    const sdk = await createReactNativeAnalytics(f.options);
    await sdk.track('feature_used\n');
    expect((await sdk.getStatus()).queued).toBe(1);
    expect(() => sdk.onboarding({ id: 'flow\n', steps: ['intro'] })).toThrow();
    expect(() => sdk.paywall({ id: 'wall\n' })).toThrow();
    expect(await sdk.paywall({ id: 'wall' }).view({ placement: 'settings\n' })).toBeNull();
    await sdk.dispose();
  });

  it('fails closed when injected IDs repeat with different UUID casing', async () => {
    let replacement: string | undefined;
    const f = fixture({ generateId: () => replacement ?? randomUUID() });
    const sdk = await createReactNativeAnalytics(f.options);
    const identity = await sdk.getIdentity();
    replacement = identity.anonymousId.toUpperCase();
    await expect(sdk.reset()).rejects.toThrow();
    expect(await sdk.getIdentity()).toEqual(identity);
    replacement = JSON.parse([...f.data.values()][0]).events[0].event_id.toUpperCase();
    await sdk.track('feature_used');
    expect((await sdk.getStatus()).queued).toBe(1);
    await sdk.dispose();
  });

  it('preserves workflow handles when an injected purchase ID repeats across views', async () => {
    let replacement: string | undefined;
    const f = fixture({ generateId: () => replacement ?? randomUUID() });
    const sdk = await createReactNativeAnalytics(f.options);
    const wall = sdk.paywall({ id: 'wall' });
    const first = await wall.view({ placement: 'settings' });
    const purchase = await first!.purchaseStarted({ productId: 'monthly' });
    const second = await wall.view({ placement: 'settings' });
    replacement = purchase!.attemptId.toUpperCase();
    expect(await second!.purchaseStarted({ productId: 'monthly' })).toBeNull();
    replacement = undefined;
    expect(await purchase!.finished({ result: 'succeeded' })).toBe(true);
    await sdk.dispose();
  });

  it('diagnoses malformed runtime workflow inputs without raw TypeErrors or state changes', async () => {
    const f = fixture();
    const sdk = await createReactNativeAnalytics(f.options);
    const flow = sdk.onboarding({ id: 'main', version: 1, steps: ['goal'] });
    await expect(flow.start(null as never)).resolves.toBeNull();
    await expect(flow.answer('goal', 42 as never)).resolves.toBeUndefined();
    const wall = sdk.paywall({ id: 'premium' });
    await expect(wall.view(null as never)).resolves.toBeNull();
    await expect(wall.view({ placement: 'settings', productIds: 42 as never })).resolves.toBeNull();
    await expect(wall.view({ placement: 'settings', properties: [] as never })).resolves.toBeNull();
    expect((await sdk.getStatus()).queued).toBe(1);
    expect(f.onDiagnostic.mock.calls.map(([d]) => d.code)).toEqual(Array(5).fill('invalid_event'));
    const view = await wall.view({ placement: 'settings' });
    await expect(view!.dismissed(null as never)).resolves.toBe(false);
    await sdk.dispose();
  });

  it('does not permit redirect-following transport for analytics or feedback', async () => {
    const transport = vi.fn(async (url, init) =>
      url.endsWith('/v1/feedback')
        ? Response.json({
            id: JSON.parse(String(init?.body)).id,
            received_at: new Date().toISOString(),
          })
        : acknowledge(events(init)),
    );
    const sdk = await createReactNativeAnalytics(fixture({ fetch: transport }).options);
    await sdk.flush();
    await sdk.feedback({ message: 'Explicit fixture feedback', submissionId: randomUUID() });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
    await sdk.dispose();
  });

  it('rejects newline-suffixed feedback UUIDs and exposes bounded HTTP-date retry delays', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(
      async () =>
        new Response('{}', {
          status: 429,
          headers: { 'Retry-After': new Date(Date.now() + 60000).toUTCString() },
        }),
    );
    const sdk = await createReactNativeAnalytics(fixture({ fetch: transport }).options);
    try {
      await expect(
        sdk.feedback({ message: 'Hello', submissionId: `${randomUUID()}\n` }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
      expect(transport).not.toHaveBeenCalled();
      await expect(
        sdk.feedback({ message: 'Hello', submissionId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: expect.any(Number) });
    } finally {
      await sdk.dispose();
      vi.useRealTimers();
    }
  });

  it('rejects corrupt workflow state without replacing it, while preserving legacy optional fields', async () => {
    const f = fixture();
    const sdk = await createReactNativeAnalytics(f.options);
    const flow = sdk.onboarding({
      id: 'main',
      version: 1,
      steps: ['goal'],
      questions: [
        {
          id: 'goal',
          stepId: 'goal',
          title: 'Goal?',
          type: 'multiple',
          options: [
            { id: 'focus', label: 'Focus' },
            { id: 'habit', label: 'Habit' },
          ],
        },
      ],
    });
    await flow.start();
    await flow.step('goal');
    await flow.answer('goal', ['focus', 'habit']);
    const view = await sdk
      .paywall({ id: 'premium' })
      .view({ placement: 'settings', productIds: ['monthly'] });
    const purchase = await view!.purchaseStarted({ productId: 'monthly' });
    await purchase!.finished({ result: 'pending' });
    await sdk.dispose();
    const [key, original] = [...f.data.entries()][0];
    const mutations: ((state: any) => void)[] = [
      (s) => {
        s.onboarding['main/1'].answers.goal.revision = -100;
      },
      (s) => {
        s.onboarding['main/1'].answers.goal.revision = Number.MAX_SAFE_INTEGER + 1;
      },
      (s) => {
        s.onboarding['main/1'].answers.goal.values = ['habit', 'focus'];
      },
      (s) => {
        s.onboarding['main/1'].answers.goal.values = ['unknown'];
      },
      (s) => {
        s.onboarding['main/1'].definition.questions[0].type = ['multiple'];
      },
      (s) => {
        s.onboarding['main/1'].definition.steps = ['goal', 'goal'];
      },
      (s) => {
        s.onboarding.wrong = s.onboarding['main/1'];
        delete s.onboarding['main/1'];
      },
      (s) => {
        s.onboarding['main/1'].nextStep = 0;
        s.onboarding['main/1'].completed = true;
      },
      (s) => {
        s.paywalls[view!.viewId].purchases[purchase!.attemptId].product.productId = 'unlisted';
      },
      (s) => {
        s.paywalls[view!.viewId].purchases[purchase!.attemptId].result.result = 'invented';
      },
      (s) => {
        s.paywalls[view!.viewId].context.paywall_view_id = randomUUID();
      },
      (s) => {
        s.paywalls[view!.viewId].context.flow_id = 'incomplete';
      },
      (s) => {
        s.paywalls[view!.viewId].context.result = 'pending';
      },
      (s) => {
        s.paywalls[view!.viewId].dismissed = 'unknown';
      },
      (s) => {
        s.events[0].installation_id = randomUUID();
      },
      (s) => {
        s.events[0].platform = ['test'];
      },
    ];
    for (const mutate of mutations) {
      const state = JSON.parse(original);
      mutate(state);
      const corrupt = JSON.stringify(state);
      f.data.set(key, corrupt);
      await expect(createReactNativeAnalytics(f.options)).rejects.toThrow(
        'Unsupported analytics storage',
      );
      expect(f.data.get(key)).toBe(corrupt);
    }
    const legacy = JSON.parse(original);
    delete legacy.onboarding;
    delete legacy.paywalls;
    delete legacy.revenuecatIdentity;
    f.data.set(key, JSON.stringify(legacy));
    const restored = await createReactNativeAnalytics(f.options);
    expect((await restored.getIdentity()).installationId).toBe(legacy.installationId);
    expect((await restored.getStatus()).queued).toBe(legacy.events.length);
    await restored.dispose();
  });
});
