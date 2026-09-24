import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eventSchema } from '../packages/contracts/src/index.js';
import {
  createReactNativeAnalytics,
  type AnalyticsEvent,
  type AnalyticsOptions,
} from '../sdks/react-native/src/index.js';

function fixture(extra: Partial<AnalyticsOptions> = {}) {
  const data = new Map<string, string>(),
    events: AnalyticsEvent[] = [],
    diagnostic = vi.fn();
  const options: AnalyticsOptions = {
    appId: randomUUID(),
    environment: 'development',
    apiUrl: 'http://localhost:4400',
    collectionKey: 'test',
    platform: 'test',
    appVersion: 'test',
    generateId: randomUUID,
    flushIntervalMs: 0,
    onDiagnostic: diagnostic,
    storage: {
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        data.set(k, v);
      },
    },
    fetch: async (_url, init) => {
      const batch = JSON.parse(String(init?.body)).events as AnalyticsEvent[];
      events.push(...batch);
      return new Response(JSON.stringify({ accepted: batch.map((e) => e.event_id), rejected: [] }));
    },
    ...extra,
  };
  return { options, events, diagnostic, data };
}
describe('first-class paywall tracking', () => {
  it('snapshots access at presentation, persists it across restart and validates the public field', async () => {
    const f = fixture();
    let sdk = await createReactNativeAnalytics(f.options);
    const options = {
      placement: 'settings',
      accessState: 'inactive' as const,
      properties: { paywall_access_state: 'active' },
    };
    const view = (await sdk.paywall({ id: 'upgrade' }).view(options))!;
    await sdk.flush();
    await sdk.dispose();
    sdk = await createReactNativeAnalytics(f.options);
    const restored = (await sdk.paywall({ id: 'upgrade' }).getView(view.viewId))!;
    await (await restored.purchaseStarted({ productId: 'monthly' }))!.finished({
      result: 'succeeded',
    });
    await sdk.flush();
    const rows = f.events.filter((e) => e.properties.paywall_view_id === view.viewId);
    expect(rows.length).toBe(3);
    expect(
      rows.every(
        (e) => e.properties.paywall_access_state === 'inactive' && eventSchema.safeParse(e).success,
      ),
    ).toBe(true);
    expect(
      eventSchema.safeParse({
        ...rows[0],
        properties: { ...rows[0].properties, paywall_access_state: 'paid-ish' },
      }).success,
    ).toBe(false);
    expect(
      await sdk
        .paywall({ id: 'upgrade' })
        .view({ placement: 'settings', accessState: 'bad' as 'active' }),
    ).toBeNull();
    await sdk.dispose();
  });
  it('links exact products, onboarding, views and attempts; pending resolves once even after dismissal', async () => {
    const f = fixture(),
      sdk = await createReactNativeAnalytics(f.options);
    const onboarding = sdk.onboarding({ id: 'welcome', version: 2, steps: ['intro'] });
    const onboardingId = await onboarding.start();
    const wall = sdk.paywall({ id: 'upgrade', version: 3 });
    const view = (await wall.view({
      placement: 'onboarding',
      productIds: ['pro.monthly', 'pro:annual'],
      onboarding,
    }))!;
    await view.productSelected({ productId: 'pro:annual', offerId: 'trial_7d' });
    const purchase = (await view.purchaseStarted({
      productId: 'pro:annual',
      offerId: 'trial_7d',
    }))!;
    expect(await purchase.finished({ result: 'pending' })).toBe(true);
    expect(await purchase.finished({ result: 'pending' })).toBe(true);
    expect(await view.dismissed({ reason: 'close_button' })).toBe(true);
    expect(await view.dismissed()).toBe(true);
    const resumed = (await wall.getView(view.viewId))!;
    const resumedPurchase = (await resumed.getPurchase(purchase.attemptId))!;
    await Promise.all([
      resumedPurchase.finished({ result: 'succeeded', transactionId: 'store_tx_1' }),
      purchase.finished({ result: 'succeeded', transactionId: 'store_tx_1' }),
    ]);
    expect(await purchase.finished({ result: 'failed' })).toBe(false);
    expect(await view.productSelected({ productId: 'pro.monthly' })).toBe(false);
    const other = (await wall.view({ placement: 'settings' }))!;
    expect(other.viewId).not.toBe(view.viewId);
    await sdk.flush();
    const first = f.events.filter((e) => e.properties.paywall_view_id === view.viewId);
    expect(first.map((e) => e.name)).toEqual([
      'paywall_viewed',
      'paywall_product_selected',
      'paywall_purchase_started',
      'paywall_purchase_result',
      'paywall_dismissed',
      'paywall_purchase_result',
    ]);
    expect(
      first.every(
        (e) =>
          e.properties.onboarding_attempt_id === onboardingId &&
          e.properties.paywall_version === '3',
      ),
    ).toBe(true);
    expect(
      first
        .filter((e) => e.name.startsWith('paywall_purchase'))
        .every(
          (e) =>
            e.properties.product_id === 'pro:annual' &&
            e.properties.purchase_attempt_id === purchase.attemptId,
        ),
    ).toBe(true);
    expect(first.at(-1)?.properties).toMatchObject({
      result_source: 'client',
      transaction_id: 'store_tx_1',
    });
    for (const e of f.events) expect(eventSchema.safeParse(e).success).toBe(true);
    await sdk.dispose();
  });
  it('retains pending purchase context and event IDs across an offline process restart and lost acknowledgement', async () => {
    const f = fixture();
    const first = await createReactNativeAnalytics({
      ...f.options,
      fetch: async () => {
        throw new Error('offline');
      },
    });
    const view = (await first
      .paywall({ id: 'upgrade' })
      .view({ placement: 'settings', productIds: ['annual'] }))!;
    const purchase = (await view.purchaseStarted({ productId: 'annual' }))!;
    await purchase.finished({ result: 'pending' });
    await first.flush();
    const before = JSON.parse([...f.data.values()][0]).events;
    await first.dispose();
    let loseAck = true;
    const second = await createReactNativeAnalytics({
      ...f.options,
      fetch: async (url, init) => {
        const response = await f.options.fetch!(url, init);
        if (loseAck) {
          loseAck = false;
          throw new Error('lost ack');
        }
        return response;
      },
    });
    const recovered = (await second.paywall({ id: 'upgrade' }).getView(view.viewId))!;
    await (await recovered.getPurchase(purchase.attemptId))!.finished({ result: 'succeeded' });
    await second.flush();
    await second.resume();
    expect(f.events.slice(0, before.length)).toEqual(before);
    expect(new Set(f.events.map((e) => e.event_id)).size).toBe(5);
    expect((await second.getStatus()).queued).toBe(0);
    expect(f.events.filter((e) => e.name === 'paywall_viewed')).toHaveLength(2); // One event, delivered twice.
    await second.dispose();
  });
  it('snapshots product lists, custom properties, product selection and callback values at call time', async () => {
    let now = new Date('2026-09-01T10:00:00Z');
    const f = fixture({ now: () => now }),
      sdk = await createReactNativeAnalytics(f.options);
    const productIds = ['annual'],
      properties = {
        tags: ['example'],
        paywall_id: 'spoof',
        product_id: 'spoof',
        flow_id: 'spoof',
      };
    const pending = sdk
      .paywall({ id: 'upgrade' })
      .view({ placement: 'home', productIds, properties });
    productIds[0] = 'mutated';
    properties.tags[0] = 'mutated';
    now = new Date('2026-09-02T10:00:00Z');
    const view = (await pending)!;
    const product = { productId: 'annual' };
    const starting = view.purchaseStarted(product);
    product.productId = 'mutated';
    const purchase = (await starting)!;
    const result = { result: 'succeeded' as const, transactionId: 'original' };
    const finishing = purchase.finished(result);
    result.transactionId = 'mutated';
    await finishing;
    await sdk.flush();
    expect(f.events[1]).toMatchObject({
      occurred_at: '2026-09-01T10:00:00.000Z',
      properties: { product_ids: ['annual'], tags: ['example'], paywall_id: 'upgrade' },
    });
    expect(f.events[1].properties.flow_id).toBeUndefined();
    expect(f.events[1].properties.product_id).toBeUndefined();
    expect(f.events[2].properties.product_id).toBe('annual');
    expect(f.events[3].properties.transaction_id).toBe('original');
    await sdk.dispose();
  });
  it('invalidates handles on identity reset and opt-out while preserving earlier event identity', async () => {
    const f = fixture(),
      sdk = await createReactNativeAnalytics(f.options),
      wall = sdk.paywall({ id: 'upgrade' });
    const anonymous = (await sdk.getIdentity()).anonymousId;
    const view = (await wall.view({ placement: 'home' }))!;
    const purchase = (await view.purchaseStarted({ productId: 'annual' }))!;
    await sdk.identify('account');
    await purchase.finished({ result: 'pending' });
    await sdk.reset();
    expect(await purchase.finished({ result: 'succeeded' })).toBe(false);
    expect(await wall.getView(view.viewId)).toBeNull();
    await sdk.flush();
    expect(
      f.events
        .filter((e) => e.properties.paywall_view_id === view.viewId)
        .every((e) => e.anonymous_id === anonymous),
    ).toBe(true);
    const next = (await wall.view({ placement: 'home' }))!;
    await sdk.setEnabled(false);
    await sdk.setEnabled(true);
    expect(await next.dismissed()).toBe(false);
    expect((await sdk.getStatus()).queued).toBe(0);
    await sdk.dispose();
    expect(await wall.view({ placement: 'home' })).toBeNull();
  });
  it('does not advance state when the queue is full or storage fails', async () => {
    const f = fixture({ maxQueueSize: 1 });
    let fail = false;
    const setItem = f.options.storage.setItem;
    f.options.storage.setItem = async (k, v) => {
      if (fail) throw new Error('disk full');
      await setItem(k, v);
    };
    const sdk = await createReactNativeAnalytics(f.options),
      wall = sdk.paywall({ id: 'upgrade' });
    expect(await wall.view({ placement: 'home' })).toBeNull();
    await sdk.flush();
    const view = (await wall.view({ placement: 'home' }))!;
    expect(await view.purchaseStarted({ productId: 'annual' })).toBeNull();
    await sdk.flush();
    fail = true;
    expect(await view.purchaseStarted({ productId: 'annual' })).toBeNull();
    fail = false;
    const purchase = (await view.purchaseStarted({ productId: 'annual' }))!;
    expect(await purchase.finished({ result: 'succeeded' })).toBe(false);
    await sdk.flush();
    fail = true;
    expect(await purchase.finished({ result: 'succeeded' })).toBe(false);
    fail = false;
    expect(await purchase.finished({ result: 'succeeded' })).toBe(true);
    await sdk.flush();
    expect(f.events.map((e) => e.name)).toEqual([
      'app_first_open',
      'paywall_viewed',
      'paywall_purchase_started',
      'paywall_purchase_result',
    ]);
    await sdk.dispose();
  });
  it('rejects invalid versions, missing flow context, unshown products and invalid results locally', async () => {
    const f = fixture(),
      sdk = await createReactNativeAnalytics(f.options);
    for (const version of [0, -1, 1.5, NaN, Infinity, null, '1'])
      expect(() => sdk.paywall({ id: 'upgrade', version: version as number })).toThrow();
    const wall = sdk.paywall({ id: 'upgrade' });
    expect(await wall.view({ placement: 'home', productIds: [] })).toBeNull();
    expect(await wall.view({ placement: 'home', productIds: ['a', 'a'] })).toBeNull();
    expect(
      await wall.view({
        placement: 'home',
        onboarding: sdk.onboarding({ id: 'intro', steps: ['hi'] }),
      }),
    ).toBeNull();
    const view = (await wall.view({ placement: 'home', productIds: ['annual'] }))!;
    expect(await view.purchaseStarted({ productId: 'monthly' })).toBeNull();
    const purchase = (await view.purchaseStarted({ productId: 'annual' }))!;
    expect(await purchase.finished({ result: 'verified' as never })).toBe(false);
    await sdk.flush();
    expect(f.events).toHaveLength(3);
    expect(f.diagnostic).toHaveBeenCalled();
    await sdk.dispose();
  });
  it('bounds resumable views without deleting their queued history', async () => {
    const f = fixture({
        maxQueueSize: 1000,
        fetch: async () => {
          throw new Error('offline');
        },
      }),
      sdk = await createReactNativeAnalytics(f.options);
    const wall = sdk.paywall({ id: 'upgrade' }),
      first = (await wall.view({ placement: 'home' }))!;
    let latest = first;
    for (let i = 0; i < 100; i++) latest = (await wall.view({ placement: 'home' }))!;
    expect(await wall.getView(first.viewId)).toBeNull();
    expect(await wall.getView(latest.viewId)).not.toBeNull();
    expect((await sdk.getStatus()).queued).toBe(102);
    expect(await first.dismissed()).toBe(false);
    await sdk.dispose();
  });
  it('snapshots generic string lists and enforces list and UTF-8 property limits', async () => {
    const f = fixture(),
      sdk = await createReactNativeAnalytics(f.options);
    const list = ['one'];
    const tracked = sdk.track('example', { list });
    list[0] = 'changed';
    await tracked;
    await sdk.track('too_many', { list: Array(21).fill('x') });
    await sdk.track('too_large', {
      a: '😀'.repeat(1000),
      b: '😀'.repeat(1000),
      c: '😀'.repeat(1000),
    });
    await sdk.flush();
    expect(f.events).toHaveLength(2);
    expect(f.events[1].properties.list).toEqual(['one']);
    await sdk.dispose();
  });
});
