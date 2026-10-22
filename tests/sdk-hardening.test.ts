import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createReactNativeAnalytics,
  type AnalyticsOptions,
  type AnalyticsEvent,
} from '../sdks/react-native/src/index.js';
import { SDK_VERSION } from '../sdks/react-native/src/version.js';
import { backoffDelay } from '../packages/sdk-core/src/delivery.js';
import { uuidv7 } from '../packages/sdk-core/src/uuid.js';

const key = `ma_prod_${randomUUID()}_${'0'.repeat(48)}`;
function fixture(overrides: Partial<AnalyticsOptions> = {}) {
  const data = new Map<string, string>();
  const onDiagnostic = vi.fn();
  const options: AnalyticsOptions = {
    apiUrl: 'https://analytics.example',
    collectionKey: key,
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
    f.options.collectionKey = `ma_prod_${randomUUID()}_${'1'.repeat(48)}`;
    await sdk.flush();
    expect(transport.mock.calls[0][0]).toBe('https://analytics.example/v1/events/batch');
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({
      'X-API-Key': key,
      'X-Appbase-SDK': `react-native/${SDK_VERSION}`,
      'X-Appbase-Dropped': '0',
    });
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
  it('fails closed on an unreadable identity root without replacing saved data', async () => {
    const f = fixture();
    const first = await createReactNativeAnalytics(f.options);
    await first.dispose();
    const [key, raw] = [...f.data.entries()][0];
    for (const corrupt of [
      JSON.stringify({ ...JSON.parse(raw), installationId: 'not-a-uuid' }),
      JSON.stringify({ ...JSON.parse(raw), version: 2 }),
      '{"truncated":',
    ]) {
      f.data.set(key, corrupt);
      await expect(createReactNativeAnalytics(f.options)).rejects.toThrow();
      expect(f.data.get(key)).toBe(corrupt);
    }
  });

  it('drops unreadable stored events as dropped instead of failing every launch', async () => {
    const f = fixture();
    const first = await createReactNativeAnalytics(f.options);
    await first.track('kept');
    await first.track('corrupted');
    const identity = await first.getIdentity();
    await first.dispose();
    const [key, raw] = [...f.data.entries()][0];
    const state = JSON.parse(raw);
    state.events[2].properties = { invalid: { nested: true } };
    state.events.push({ ...state.events[1] });
    f.data.set(key, JSON.stringify(state));
    const restored = await createReactNativeAnalytics(f.options);
    expect(await restored.getIdentity()).toEqual(identity);
    expect(await restored.getStatus()).toMatchObject({ queued: 2, dropped: 2 });
    expect(f.onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'storage' }));
    // Saved once, so the next launch neither drops nor counts them again.
    const saved = JSON.parse(f.data.get(key)!);
    expect(saved.events.map((e: AnalyticsEvent) => e.name)).toEqual(['app_first_open', 'kept']);
    await restored.dispose();
    const again = await createReactNativeAnalytics(f.options);
    expect(await again.getStatus()).toMatchObject({ queued: 2, dropped: 2 });
    await again.dispose();
  });

  it('keeps the queue within its byte budget, dropping the newest event', async () => {
    const f = fixture({ maxQueueBytes: 2000 });
    const sdk = await createReactNativeAnalytics(f.options);
    await sdk.track('big', { blob: 'x'.repeat(1000) });
    await sdk.track('big', { blob: 'y'.repeat(1000) });
    await sdk.track('small');
    expect(await sdk.getStatus()).toMatchObject({ queued: 3, dropped: 1 });
    await expect(
      createReactNativeAnalytics(fixture({ maxQueueBytes: 5 * 1024 * 1024 + 1 }).options),
    ).rejects.toThrow();
    await sdk.dispose();
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
    expect(transport.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true);
    await sdk.dispose();
  });

  it('treats a redirect (including a browser opaque redirect) as a configuration block', async () => {
    const opaque = Object.defineProperty(new Response(null, { status: 200 }), 'type', {
      value: 'opaqueredirect',
    });
    const transport = vi.fn(async () => opaque);
    const f = fixture({ fetch: transport });
    const sdk = await createReactNativeAnalytics(f.options);
    await sdk.flush();
    expect(await sdk.getStatus()).toMatchObject({ queued: 1, blocked: true });
    await expect(
      sdk.feedback({ message: 'Hello', submissionId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'configuration' });
    await sdk.dispose();
  });

  it('backs off with full jitter from about 2 seconds to at most 15 minutes', () => {
    expect(backoffDelay(1, 0)).toBe(1000);
    expect(backoffDelay(1, 0.999)).toBeLessThan(2000);
    expect(backoffDelay(3, 0.999)).toBeLessThan(8000);
    expect(backoffDelay(50, 0.999)).toBeLessThan(900_000);
    expect(backoffDelay(50, 0.999)).toBeGreaterThan(890_000);
    expect(backoffDelay(50, 0)).toBe(1000);
  });

  it('applies server control: retry floor and a longer (never shorter) flush interval', async () => {
    vi.useFakeTimers();
    try {
      let mode: 'steer' | 'offline' | 'ack' = 'steer';
      const transport = vi.fn(async (_url, init) => {
        if (mode === 'offline') throw new Error('offline');
        const batch = events(init);
        return Response.json({
          accepted: batch.map((e) => e.event_id),
          rejected: [],
          ...(mode === 'steer'
            ? { control: { min_retry_ms: 300_000, flush_interval_ms: 60_000, max_batch: 'x' } }
            : {}),
        });
      });
      const sdk = await createReactNativeAnalytics(
        fixture({ fetch: transport, flushIntervalMs: 1000 }).options,
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport).toHaveBeenCalledTimes(1);
      await sdk.track('steered');
      await vi.advanceTimersByTimeAsync(59_000);
      expect(transport).toHaveBeenCalledTimes(1);
      mode = 'offline';
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport).toHaveBeenCalledTimes(2);
      const { retryAt } = await sdk.getStatus();
      expect(retryAt - Date.now()).toBeGreaterThanOrEqual(299_000);
      mode = 'ack';
      await vi.advanceTimersByTimeAsync(300_000);
      // The acknowledgement without control restored the app's own one-second interval.
      await sdk.track('released');
      await vi.advanceTimersByTimeAsync(1000);
      expect((await sdk.getStatus()).queued).toBe(0);
      expect(transport.mock.calls.length).toBe(4);
      await sdk.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('generates time-ordered UUIDv7 IDs when the host supplies no generator', async () => {
    const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuidv7(Date.parse('2026-09-01T12:00:00.000Z')).slice(0, 13)).toBe('01a05cd7-2a00');
    let at = Date.parse('2026-09-01T12:00:00.000Z');
    const sent: AnalyticsEvent[] = [];
    const { generateId: _, ...options } = fixture({
      now: () => new Date((at += 1000)),
      fetch: async (_url, init) => {
        sent.push(...events(init));
        return acknowledge(events(init));
      },
    }).options;
    const sdk = await createReactNativeAnalytics(options);
    for (let i = 0; i < 20; i++) await sdk.track('ordered');
    await sdk.flush();
    const identity = await sdk.getIdentity();
    expect(identity.installationId).toMatch(v7);
    expect(identity.anonymousId).toMatch(v7);
    expect(sent).toHaveLength(21);
    expect(sent.every((e) => v7.test(e.event_id))).toBe(true);
    expect(sent.map((e) => e.event_id)).toEqual(sent.map((e) => e.event_id).sort());
    await sdk.dispose();
  });

  it('stores no identifier or event before consent with initiallyEnabled: false', async () => {
    const transport = vi.fn(async (_url, init) => acknowledge(events(init)));
    const f = fixture({ fetch: transport, initiallyEnabled: false });
    let sdk = await createReactNativeAnalytics(f.options);
    await sdk.track('before_consent');
    await sdk.identify('someone');
    await sdk.setEnabled(false);
    await sdk.flush();
    expect(f.data.size).toBe(0);
    expect(transport).not.toHaveBeenCalled();
    expect(await sdk.getStatus()).toMatchObject({ enabled: false, queued: 0 });
    await sdk.setEnabled(true);
    const saved = JSON.parse([...f.data.values()][0]);
    expect(saved.events.map((e: AnalyticsEvent) => e.name)).toEqual(['app_first_open']);
    expect(saved.installationId).toBe((await sdk.getIdentity()).installationId);
    await sdk.dispose();
    // Once stored, the installation's own choice wins over initiallyEnabled.
    sdk = await createReactNativeAnalytics(f.options);
    expect((await sdk.getStatus()).enabled).toBe(true);
    await sdk.dispose();
  });

  it('keeps a server Retry-After and a configuration block across restarts', async () => {
    let at = Date.parse('2026-09-01T12:00:00Z');
    const answers = [
      new Response('{}', { status: 503, headers: { 'Retry-After': '120' } }),
      new Response('{}', { status: 403 }),
    ];
    const transport = vi.fn(async (_url, init) => answers.shift() ?? acknowledge(events(init)));
    const f = fixture({ fetch: transport, now: () => new Date(at) });
    let sdk = await createReactNativeAnalytics(f.options);
    await sdk.flush();
    await sdk.dispose();
    sdk = await createReactNativeAnalytics(f.options);
    await sdk.resume();
    expect(transport).toHaveBeenCalledTimes(1);
    at += 121_000;
    await sdk.flush();
    expect(await sdk.getStatus()).toMatchObject({ blocked: true, queued: 1 });
    await sdk.dispose();
    sdk = await createReactNativeAnalytics(f.options);
    await sdk.flush();
    expect(transport).toHaveBeenCalledTimes(2);
    at += 3_600_000;
    await sdk.flush();
    expect(await sdk.getStatus()).toMatchObject({ blocked: false, queued: 0 });
    // Another key of the same app does not inherit the old key's answers.
    const [key, raw] = [...f.data.entries()][0];
    f.data.set(key, JSON.stringify({ ...JSON.parse(raw), delivery: { key: 'other', gone: true } }));
    await sdk.dispose();
    sdk = await createReactNativeAnalytics(f.options);
    await sdk.track('after_rotation');
    expect(await sdk.getStatus()).toMatchObject({ blocked: false, queued: 1 });
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

  it('clears an unreadable workflow section and keeps identity, queue and legacy optional fields', async () => {
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
    const queued = JSON.parse(original).events.length;
    for (const [index, mutate] of mutations.entries()) {
      const state = JSON.parse(original);
      mutate(state);
      f.data.set(key, JSON.stringify(state));
      const recovered = await createReactNativeAnalytics(f.options);
      expect((await recovered.getIdentity()).installationId).toBe(state.installationId);
      const saved = JSON.parse(f.data.get(key)!);
      // The last two corrupt a queued event (dropped); the rest a workflow (cleared).
      if (index >= mutations.length - 2) {
        expect(await recovered.getStatus()).toMatchObject({ queued: queued - 1, dropped: 1 });
        expect(saved.onboarding).toEqual(state.onboarding);
      } else {
        expect((await recovered.getStatus()).queued).toBe(queued);
        expect(index < 8 ? saved.onboarding : saved.paywalls).toBeUndefined();
      }
      await recovered.dispose();
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
