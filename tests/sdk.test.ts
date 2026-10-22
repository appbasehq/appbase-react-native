import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createReactNativeAnalytics,
  type AnalyticsOptions,
  type StorageAdapter,
  type AnalyticsEvent,
} from '../sdks/react-native/src/index.js';

// A fixture app's public write-only key; its app ID scopes durable SDK state.
const testKey = `ma_prod_${randomUUID()}_${'0'.repeat(48)}`;
function storage(): StorageAdapter {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
  };
}
const success = (events: AnalyticsEvent[]) =>
  new Response(JSON.stringify({ accepted: events.map((e) => e.event_id), rejected: [] }), {
    status: 200,
  });
function options(extra: Partial<AnalyticsOptions> = {}): AnalyticsOptions {
  return {
    apiUrl: 'http://localhost:4400',
    collectionKey: testKey,
    platform: 'test',
    appVersion: '1.0',
    storage: storage(),
    generateId: randomUUID,
    flushIntervalMs: 0,
    ...extra,
  };
}
const decode = (init?: RequestInit) => JSON.parse(String(init?.body)).events as AnalyticsEvent[];
describe('React Native delivery core', () => {
  it.each(['ios', 'android'] as const)(
    'diagnoses missing AppState on %s without inventing an app open',
    async (platform) => {
      const onDiagnostic = vi.fn();
      const received: AnalyticsEvent[] = [];
      const sdk = await createReactNativeAnalytics(
        options({
          platform,
          onDiagnostic,
          fetch: async (_url, init) => {
            received.push(...decode(init));
            return success(decode(init));
          },
        }),
      );
      await sdk.track('photo_exported');
      await sdk.flush();
      expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          code: 'configuration',
          message: expect.stringContaining('appState: AppState'),
        }),
      );
      expect(received.map((e) => e.name)).toEqual(['app_first_open', 'photo_exported']);
      await sdk.dispose();
    },
  );
  it.each([false, true])(
    'warns when the diagnostic handler is missing or throws (throws=%s)',
    async (throws) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const sdk = await createReactNativeAnalytics(
          options({
            platform: 'ios',
            ...(throws
              ? {
                  onDiagnostic: () => {
                    throw new Error('broken logger');
                  },
                }
              : {}),
          }),
        );
        expect(warning).toHaveBeenCalledExactlyOnceWith(
          expect.stringContaining('appState: AppState'),
        );
        expect(warning.mock.calls[0][0]).not.toContain('collectionKey');
        await sdk.dispose();
      } finally {
        warning.mockRestore();
      }
    },
  );
  it('allows headless test clients without a native lifecycle warning', async () => {
    const onDiagnostic = vi.fn();
    const sdk = await createReactNativeAnalytics(options({ onDiagnostic }));
    expect(onDiagnostic).not.toHaveBeenCalled();
    await sdk.dispose();
  });
  it('records an already-active cold launch and later foreground transitions', async () => {
    let listener!: (state: string) => void;
    const remove = vi.fn();
    const received: AnalyticsEvent[] = [];
    const onDiagnostic = vi.fn();
    const sdk = await createReactNativeAnalytics(
      options({
        platform: 'ios',
        onDiagnostic,
        appState: {
          currentState: 'active',
          addEventListener: (_event, fn) => {
            listener = fn;
            return { remove };
          },
        },
        fetch: async (_url, init) => {
          received.push(...decode(init));
          return success(decode(init));
        },
      }),
    );
    await sdk.flush();
    expect(received.map((e) => e.name)).toEqual(['app_first_open', 'app_active']);
    listener('background');
    listener('active');
    await vi.waitFor(() => expect(received.filter((e) => e.name === 'app_active')).toHaveLength(2));
    await sdk.dispose();
    expect(remove).toHaveBeenCalledOnce();
    expect(onDiagnostic).not.toHaveBeenCalled();
  });
  it('reports the device clock with each batch so the server can correct skew', async () => {
    const headers: Record<string, string>[] = [];
    const sdk = await createReactNativeAnalytics(
      options({
        now: () => new Date('2001-01-01T00:00:00Z'),
        fetch: async (_url, init) => {
          headers.push(init!.headers as Record<string, string>);
          return success(decode(init));
        },
      }),
    );
    await sdk.flush();
    expect(headers[0]['X-Appbase-Sent-At']).toBe('2001-01-01T00:00:00.000Z');
    await sdk.dispose();
  });
  it('ignores inactive-only interruptions and flushes when the app leaves the foreground', async () => {
    let listener!: (state: string) => void;
    const received: AnalyticsEvent[] = [];
    const sdk = await createReactNativeAnalytics(
      options({
        platform: 'ios',
        flushIntervalMs: 0,
        appState: {
          currentState: 'active',
          addEventListener: (_event, fn) => {
            listener = fn;
            return { remove: vi.fn() };
          },
        },
        fetch: async (_url, init) => {
          received.push(...decode(init));
          return success(decode(init));
        },
      }),
    );
    await sdk.flush();
    expect(received.map((e) => e.name)).toEqual(['app_first_open', 'app_active']);
    // Control Center, a system alert or the purchase sheet: inactive, then active again.
    listener('inactive');
    listener('active');
    await sdk.track('paywall_closed');
    // Leaving the app delivers what is queued without waiting for the next open.
    listener('inactive');
    listener('background');
    await vi.waitFor(() => expect(received.map((e) => e.name)).toContain('paywall_closed'));
    expect(received.filter((e) => e.name === 'app_active')).toHaveLength(1);
    listener('active');
    await vi.waitFor(() => expect(received.filter((e) => e.name === 'app_active')).toHaveLength(2));
    await sdk.dispose();
  });
  it('waits for foreground when initial AppState is unknown, respects opt-out, and records first-open once across restart', async () => {
    const store = storage();
    const received: AnalyticsEvent[] = [];
    let listener!: (state: string) => void;
    const setup = options({
      platform: 'ios',
      storage: store,
      appState: {
        currentState: null,
        addEventListener: (_event, fn) => {
          listener = fn;
          return { remove: vi.fn() };
        },
      },
      fetch: async (_url, init) => {
        received.push(...decode(init));
        return success(decode(init));
      },
    });
    const first = await createReactNativeAnalytics(setup);
    await first.flush();
    expect(received.map((e) => e.name)).toEqual(['app_first_open']);
    listener('background');
    listener('inactive');
    await first.flush();
    expect(received).toHaveLength(1);
    listener('active');
    await vi.waitFor(() => expect(received.filter((e) => e.name === 'app_active')).toHaveLength(1));
    await first.setEnabled(false);
    listener('active');
    await first.flush();
    expect(received).toHaveLength(2);
    await first.dispose();
    const resumed = await createReactNativeAnalytics({
      ...setup,
      appState: { ...setup.appState!, currentState: 'active' },
    });
    await resumed.flush();
    expect(received).toHaveLength(2);
    await resumed.setEnabled(true);
    listener('background');
    listener('active');
    await vi.waitFor(() => expect(received.filter((e) => e.name === 'app_active')).toHaveLength(2));
    expect(received.filter((e) => e.name === 'app_first_open')).toHaveLength(1);
    expect(new Set(received.map((e) => e.installation_id)).size).toBe(1);
    await resumed.dispose();
  });
  it('captures occurrence time and properties before queued storage work', async () => {
    const received: AnalyticsEvent[] = [];
    let time = new Date('2026-09-01T12:00:00Z');
    const sdk = await createReactNativeAnalytics(
      options({
        now: () => time,
        fetch: async (_url, init) => {
          received.push(...decode(init));
          return success(decode(init));
        },
      }),
    );
    const properties = { activity: 'workout_finished' };
    const tracking = sdk.track('activity_completed', properties);
    properties.activity = 'mutated_after_tracking';
    time = new Date('2026-09-01T12:05:00Z');
    await tracking;
    await sdk.flush();
    expect(received[1]).toMatchObject({
      occurred_at: '2026-09-01T12:00:00.000Z',
      properties: { activity: 'workout_finished' },
    });
    await sdk.dispose();
  });
  it('rejects non-finite values before JSON can silently turn them into null', async () => {
    const onDiagnostic = vi.fn();
    const sdk = await createReactNativeAnalytics(options({ onDiagnostic }));
    await sdk.track('measurement', { value: Infinity });
    await sdk.track('measurement', { value: NaN });
    expect((await sdk.getStatus()).queued).toBe(1);
    expect(onDiagnostic).toHaveBeenCalledTimes(2);
    await sdk.dispose();
  });
  it('persists events and original identity through offline restart', async () => {
    const store = storage(),
      received: AnalyticsEvent[] = [];
    const timestamp = new Date('2026-09-01T12:00:00Z');
    const first = await createReactNativeAnalytics(
      options({
        storage: store,
        now: () => timestamp,
        fetch: async () => {
          throw new Error('offline');
        },
      }),
    );
    const identity = await first.getIdentity();
    await first.track('paywall_viewed', { placement: 'onboarding', paywall_version: 'v1' });
    await first.flush();
    await first.dispose();
    const second = await createReactNativeAnalytics(
      options({
        storage: store,
        fetch: async (_url, init) => {
          received.push(...decode(init));
          return success(decode(init));
        },
      }),
    );
    expect(await second.getIdentity()).toEqual(identity);
    await second.flush();
    expect(received).toHaveLength(2);
    expect(received.every((e) => e.occurred_at === timestamp.toISOString())).toBe(true);
    expect((await second.getStatus()).queued).toBe(0);
    await second.dispose();
  });
  it('keeps newly tracked events when a previous batch is acknowledged', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const calls: AnalyticsEvent[][] = [];
    const sdk = await createReactNativeAnalytics(
      options({
        fetch: async (_url, init) => {
          const batch = decode(init);
          calls.push(batch);
          if (calls.length === 1) await gate;
          return success(batch);
        },
      }),
    );
    const sending = sdk.flush();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await sdk.track('app_active');
    release();
    await sending;
    expect(calls.flat().map((e) => e.name)).toEqual(['app_first_open', 'app_active']);
    expect((await sdk.getStatus()).queued).toBe(0);
    await sdk.dispose();
  });
  it('preserves queued identity snapshots across identify and logout', async () => {
    const received: AnalyticsEvent[] = [];
    const sdk = await createReactNativeAnalytics(
      options({
        fetch: async (_url, init) => {
          received.push(...decode(init));
          return success(decode(init));
        },
      }),
    );
    await sdk.track('app_active');
    await sdk.identify('account-1');
    await sdk.track('app_active');
    await sdk.reset();
    await sdk.track('app_active');
    await sdk.flush();
    expect(received[1].user_id).toBeUndefined();
    expect(received[2].user_id).toBe('account-1');
    expect(received[3].user_id).toBe('account-1');
    expect(received[4].user_id).toBeUndefined();
    expect(received[4].anonymous_id).not.toBe(received[0].anonymous_id);
    expect(received[4].installation_id).toBe(received[0].installation_id);
    await sdk.dispose();
  });
  it('retains events on authentication failure and rejects foreign acknowledgements', async () => {
    const onDiagnostic = vi.fn();
    const sdk = await createReactNativeAnalytics(
      options({ onDiagnostic, fetch: async () => new Response('{}', { status: 401 }) }),
    );
    await sdk.flush();
    expect(await sdk.getStatus()).toMatchObject({ queued: 1, blocked: true });
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'blocked' }));
    await sdk.dispose();
    const other = await createReactNativeAnalytics(
      options({ fetch: async () => success([{ event_id: 'someone-else' } as AnalyticsEvent]) }),
    );
    await other.flush();
    expect((await other.getStatus()).queued).toBe(1);
    await other.dispose();
  });
  it('bounds the queue and persists opt-out across restarts', async () => {
    const store = storage(),
      diagnose = vi.fn();
    const sdk = await createReactNativeAnalytics(
      options({ storage: store, maxQueueSize: 2, onDiagnostic: diagnose }),
    );
    await sdk.track('app_active');
    await sdk.track('app_active');
    expect(await sdk.getStatus()).toMatchObject({ queued: 2, dropped: 1 });
    await sdk.setEnabled(false);
    await sdk.track('app_active');
    expect((await sdk.getStatus()).queued).toBe(0);
    await sdk.dispose();
    const resumed = await createReactNativeAnalytics(options({ storage: store }));
    expect((await resumed.getStatus()).enabled).toBe(false);
    await resumed.dispose();
  });
  it('isolates queues by app', async () => {
    const store = storage();
    const a = await createReactNativeAnalytics(options({ storage: store }));
    const b = await createReactNativeAnalytics(
      options({ storage: store, collectionKey: `ma_prod_${randomUUID()}_${'0'.repeat(48)}` }),
    );
    expect((await a.getIdentity()).anonymousId).not.toBe((await b.getIdentity()).anonymousId);
    await a.dispose();
    await b.dispose();
  });
});

describe('mobile onboarding helper', () => {
  it('rejects invalid numeric versions before creating an attempt or event', async () => {
    const sdk = await createReactNativeAnalytics(options());
    const before = (await sdk.getStatus()).queued;
    for (const version of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      null,
      true,
      {},
    ]) {
      expect(() =>
        sdk.onboarding({ id: 'main', version: version as number, steps: ['intro'] }),
      ).toThrow('positive safe integer');
    }
    const largest = sdk.onboarding({
      id: 'main',
      version: Number.MAX_SAFE_INTEGER,
      steps: ['intro'],
    });
    expect(largest.definition.version).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(await largest.getState()).toBeNull();
    expect((await sdk.getStatus()).queued).toBe(before);
    await sdk.dispose();
  });
  it('persists attempts, resumes after restart, and snapshots explicit version definitions', async () => {
    const store = storage(),
      received: AnalyticsEvent[] = [];
    const config = options({
      storage: store,
      fetch: async (_url, init) => {
        received.push(...decode(init));
        return success(decode(init));
      },
    });
    const first = await createReactNativeAnalytics(config);
    const steps = ['intro', 'goal'];
    const flow = first.onboarding({ id: 'main', version: '1', steps }); // Existing string config.
    steps.push('changed_after_definition');
    const id = await flow.start();
    expect(await flow.start()).toBe(id);
    await flow.step('intro');
    await first.identify('account-1');
    await first.dispose();
    const second = await createReactNativeAnalytics(config);
    const resumed = second.onboarding({ id: 'main', version: 1, steps: ['intro', 'goal'] });
    expect(await resumed.start()).toBe(id);
    expect(await resumed.getState()).toMatchObject({
      attemptId: id,
      nextStep: 1,
      completed: false,
    });
    await resumed.step('intro'); // Back navigation may revisit an already-reached step.
    await resumed.step('goal');
    await resumed.complete();
    await resumed.complete();
    await resumed.start(); // Completed attempts do not silently restart.
    await second.flush();
    const events = received.filter((e) => e.name.startsWith('onboarding_'));
    expect(events.filter((e) => e.name === 'onboarding_started')).toHaveLength(1);
    expect(events.filter((e) => e.name === 'onboarding_completed')).toHaveLength(1);
    expect(new Set(events.map((e) => e.properties.attempt_id))).toEqual(new Set([id]));
    expect(new Set(events.map((e) => e.properties.flow_version))).toEqual(new Set(['1']));
    expect(
      events.every(
        (e) =>
          JSON.stringify(e.onboarding) ===
          JSON.stringify({ id: 'main', version: '1', steps: ['intro', 'goal'] }),
      ),
    ).toBe(true);
    expect(events[0].user_id).toBeUndefined();
    expect(events.at(-1)?.user_id).toBe('account-1');
    expect(await resumed.restart()).not.toBe(id);
    await second.reset();
    expect(await resumed.getState()).toBeNull();
    await resumed.start();
    await second.setEnabled(false);
    expect(await resumed.getState()).toBeNull();
    expect(await resumed.start()).toBeNull();
    await second.dispose();
  });
  it('generates stable versions, warns on changed steps and rejects invalid step sequences', async () => {
    const diagnostics = vi.fn();
    const sdk = await createReactNativeAnalytics(options({ onDiagnostic: diagnostics }));
    const first = sdk.onboarding({ id: 'main', steps: ['intro', 'goal'] });
    expect(sdk.onboarding({ id: 'main', steps: ['intro', 'goal'] }).definition.version).toBe(
      first.definition.version,
    );
    expect(sdk.onboarding({ id: 'main', steps: ['goal', 'intro'] }).definition.version).not.toBe(
      first.definition.version,
    );
    sdk.onboarding({ id: 'explicit', version: 1, steps: ['intro'] });
    expect(
      sdk.onboarding({ id: 'explicit', version: 'v1', steps: ['legacy'] }).definition.version,
    ).toBe('v1');
    // A changed version never throws: it warns, and the server keeps both definitions.
    expect(
      sdk.onboarding({ id: 'explicit', version: '1', steps: ['changed'] }).definition.steps,
    ).toEqual(['changed']);
    expect(() => sdk.onboarding({ id: 'invalid', steps: ['duplicate', 'duplicate'] })).toThrow(
      'unique',
    );
    await first.step('intro'); // Start is missing.
    await first.start();
    await first.step('goal'); // Skips the declared first step.
    await first.complete(); // Still incomplete.
    expect(diagnostics.mock.calls.map(([d]) => d.code)).toEqual([
      'configuration',
      'invalid_event',
      'invalid_event',
      'invalid_event',
    ]);
    expect(diagnostics.mock.calls[0][0].message).toContain('changed its steps');
    expect((await first.getState())?.nextStep).toBe(0);
    expect((await sdk.getStatus()).queued).toBe(2);
    await sdk.dispose();
  });
  it('keeps working when a version changes: question edits continue, changed steps restart unfinished attempts', async () => {
    const store = storage(),
      sent: AnalyticsEvent[] = [];
    const question = (labels: string[]) => ({
      id: 'goal',
      stepId: 'goal',
      title: 'Your goal?',
      type: 'single' as const,
      options: labels.map((label, i) => ({ id: `o${i}`, label })),
    });
    const open = async (onDiagnostic = vi.fn()) => ({
      onDiagnostic,
      sdk: await createReactNativeAnalytics(
        options({
          storage: store,
          onDiagnostic,
          fetch: async (_url, init) => {
            sent.push(...decode(init));
            return success(decode(init));
          },
        }),
      ),
    });
    const v1 = await open();
    const started = v1.sdk.onboarding({
      id: 'main',
      version: 3,
      steps: ['intro', 'goal'],
      questions: [question(['Habit'])],
    });
    const finished = v1.sdk.onboarding({ id: 'done', version: 1, steps: ['intro'] });
    const attempt = await started.start();
    await started.step('intro');
    const done = await finished.start();
    await finished.step('intro');
    await finished.complete();
    await v1.sdk.dispose();

    // An added option: same version, same attempt, no warning.
    const edited = await open();
    const withOption = edited.sdk.onboarding({
      id: 'main',
      version: 3,
      steps: ['intro', 'goal'],
      questions: [question(['Habit', 'Sleep'])],
    });
    expect(await withOption.start()).toBe(attempt);
    await withOption.step('goal');
    await withOption.answer('goal', 'o1');
    expect(edited.onDiagnostic).not.toHaveBeenCalled();
    await edited.sdk.flush();
    expect(sent.find((e) => e.name === 'onboarding_answered')).toMatchObject({
      properties: { attempt_id: attempt, answer_ids: ['o1'] },
      onboarding: { steps: ['intro', 'goal'] },
    });
    await edited.sdk.dispose();

    // An added step: a warning, an unfinished attempt starts over, a finished one stays finished.
    const changed = await open();
    const withStep = changed.sdk.onboarding({
      id: 'main',
      version: 3,
      steps: ['intro', 'goal', 'plan'],
    });
    const moreSteps = changed.sdk.onboarding({ id: 'done', version: 1, steps: ['intro', 'extra'] });
    expect(changed.onDiagnostic.mock.calls.map(([d]) => d.code)).toEqual([
      'configuration',
      'configuration',
    ]);
    const restarted = await withStep.start();
    expect(restarted).not.toBeNull();
    expect(restarted).not.toBe(attempt);
    expect(await moreSteps.start()).toBe(done);
    expect(await moreSteps.getState()).toMatchObject({ attemptId: done, completed: true });
    await changed.sdk.flush();
    const restart = sent.find((e) => e.properties.attempt_id === restarted)!;
    expect(restart.onboarding?.steps).toEqual(['intro', 'goal', 'plan']);
    // A finished attempt is not started again.
    expect(
      sent.filter((e) => e.properties.attempt_id === done && e.name === 'onboarding_started'),
    ).toHaveLength(1);
    await changed.sdk.dispose();
  });
  it('reports server warnings once, on the console in development builds even with a handler', async () => {
    const onDiagnostic = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const message = 'Onboarding "main" version 3 changed its steps without a new version.';
    const respond = (init?: RequestInit) => {
      const events = decode(init);
      return Response.json({
        accepted: events.map((e) => e.event_id),
        rejected: [],
        warnings: [{ event_id: events[0].event_id, message }],
      });
    };
    try {
      for (const runtimeEnvironment of ['development', 'production'] as const) {
        const sdk = await createReactNativeAnalytics(
          options({ runtimeEnvironment, onDiagnostic, fetch: async (_url, init) => respond(init) }),
        );
        for (let i = 0; i < 2; i++) {
          await sdk.track('opened');
          await sdk.flush();
        }
        expect((await sdk.getStatus()).queued).toBe(0);
        await sdk.dispose();
      }
      expect(onDiagnostic).toHaveBeenCalledTimes(4);
      expect(onDiagnostic).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'configuration', message }),
      );
      // Development prints it once; Production leaves it to the handler.
      expect(warn).toHaveBeenCalledExactlyOnceWith(`[Appbase] ${message}`);
    } finally {
      warn.mockRestore();
    }
  });
  it('does not advance an attempt when storage fails or the queue is full', async () => {
    const store = storage();
    let fail = false;
    const sdk = await createReactNativeAnalytics(
      options({
        maxQueueSize: 1,
        storage: {
          getItem: store.getItem,
          setItem: async (k, v) => {
            if (fail) throw new Error('disk failed');
            await store.setItem(k, v);
          },
        },
        fetch: async (_url, init) => success(decode(init)),
      }),
    );
    const flow = sdk.onboarding({ id: 'main', steps: ['intro'] });
    expect(await flow.start()).toBeNull(); // first-open occupies the bounded queue.
    expect(await flow.getState()).toBeNull();
    await sdk.flush();
    fail = true;
    expect(await flow.start()).toBeNull();
    expect(await flow.getState()).toBeNull();
    fail = false;
    expect(await flow.start()).toBeTruthy();
    await flow.step('intro'); // Queue is full again.
    expect((await flow.getState())?.nextStep).toBe(0);
    await sdk.flush();
    await flow.step('intro');
    await sdk.flush();
    await flow.complete();
    expect((await flow.getState())?.completed).toBe(true);
    await sdk.dispose();
  });
});

describe('key-derived scope and server backoff', () => {
  it("scopes identity by the key's app, keeps it through key rotation and refuses other keys", async () => {
    const store = storage(),
      id = randomUUID();
    const key = (random = 'a') => `ma_prod_${id}_${random.repeat(48)}`;
    const make = (collectionKey: string, apiUrl = 'https://analytics.example') =>
      createReactNativeAnalytics(options({ collectionKey, apiUrl, storage: store }));
    const first = await make(key());
    const original = await first.getIdentity();
    await first.dispose();
    const rotated = await make(key('b'));
    expect(await rotated.getIdentity()).toEqual(original);
    // Retired development keys and keys without an app ID no longer configure a client.
    for (const retired of [`ma_dev_${id}_${'a'.repeat(48)}`, 'legacy-key', `ma_prod_${id}`])
      await expect(make(retired)).rejects.toThrow('ma_prod_');
    // Plain HTTP is allowed only for local development hosts.
    await expect(make(key(), 'http://analytics.example')).rejects.toThrow('HTTPS');
    await rotated.dispose();
  });
  it('honors 429 Retry-After even when resume or a network callback is invoked', async () => {
    vi.useFakeTimers();
    let connected!: (state: { isConnected: boolean | null }) => void;
    const transport = vi.fn(async (_url, init) =>
      transport.mock.calls.length === 1
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '10' } })
        : success(decode(init)),
    );
    const sdk = await createReactNativeAnalytics(
      options({
        fetch: transport,
        networkInfo: {
          addEventListener: (fn) => {
            connected = fn;
            return () => {};
          },
        },
      }),
    );
    try {
      await sdk.flush();
      expect((await sdk.getStatus()).queued).toBe(1);
      await sdk.resume();
      connected({ isConnected: true });
      await sdk.flush();
      expect(transport).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      await sdk.flush();
      expect(transport).toHaveBeenCalledTimes(2);
      expect((await sdk.getStatus()).queued).toBe(0);
    } finally {
      await sdk.dispose();
      vi.useRealTimers();
    }
  });
});
