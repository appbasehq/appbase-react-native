import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  connectRevenueCat,
  createReactNativeAnalytics,
  type AnalyticsEvent,
  type AnalyticsOptions,
  type PaywallView,
  type PurchaseResult,
  type RevenueCatCustomerInfo,
  type StorageAdapter,
} from '../sdks/react-native/src/index.js';

function storage(): StorageAdapter & { hold(): () => void } {
  const data = new Map<string, string>();
  let gate: Promise<void> | null = null;
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      await gate;
      data.set(k, v);
    },
    /** Blocks durable writes until the returned release function is called. */
    hold() {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
  };
}
async function sdk(extra: Partial<AnalyticsOptions> = {}) {
  const sent: AnalyticsEvent[] = [];
  let id = 0;
  const analytics = await createReactNativeAnalytics({
    appId: 'revenuecat-integration',
    environment: 'development',
    apiUrl: 'http://localhost:4400',
    collectionKey: 'test',
    platform: 'test',
    appVersion: '1.0',
    storage: storage(),
    generateId: () => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}`,
    now: () => new Date('2026-09-01T12:00:00.000Z'),
    flushIntervalMs: 0,
    fetch: async (_url, init) => {
      const events = JSON.parse(String(init?.body)).events as AnalyticsEvent[];
      sent.push(...events);
      return new Response(
        JSON.stringify({ accepted: events.map((e) => e.event_id), rejected: [] }),
        { status: 200 },
      );
    },
    ...extra,
  });
  return { analytics, sent };
}
const customer = (active: string[], requestDate?: string): RevenueCatCustomerInfo => ({
  entitlements: { active: Object.fromEntries(active.map((a) => [a, { identifier: a }])) },
  ...(requestDate ? { requestDate } : {}),
});
/** In-memory stand-in for `Purchases` from react-native-purchases. */
function revenueCat(appUserId = '$RCAnonymousID:first', info = customer([])) {
  const listeners = new Set<(info: RevenueCatCustomerInfo) => void>();
  const fake = {
    appUserId,
    info: Promise.resolve(info) as Promise<RevenueCatCustomerInfo>,
    listeners,
    getAppUserID: vi.fn(async () => fake.appUserId),
    getCustomerInfo: vi.fn(() => fake.info),
    addCustomerInfoUpdateListener: (l: (info: RevenueCatCustomerInfo) => void) => {
      listeners.add(l);
    },
    removeCustomerInfoUpdateListener: (l: (info: RevenueCatCustomerInfo) => void) =>
      listeners.delete(l),
    /** RevenueCat reporting new customer info, e.g. after logIn, a purchase or a restore. */
    update(next: RevenueCatCustomerInfo, user?: string) {
      if (user) fake.appUserId = user;
      fake.info = Promise.resolve(next);
      listeners.forEach((l) => l(next));
    },
  };
  return fake;
}
const linked = (events: AnalyticsEvent[]) =>
  events
    .filter((e) => e.name === 'revenuecat_identity_linked')
    .map((e) => e.properties.revenuecat_app_user_id);
// Shapes `react-native-purchases` returns and throws.
const purchased = (transactionIdentifier: string) => ({
  productIdentifier: 'premium.annual',
  customerInfo: customer(['premium']),
  transaction: { transactionIdentifier, productIdentifier: 'premium.annual' },
});
const rejected = (code: string, userCancelled = false) =>
  Object.assign(new Error(`RevenueCat error ${code}`), { code, userCancelled });

describe('RevenueCat integration (React Native)', () => {
  it('links the customer on connect and after RevenueCat changes, once per customer', async () => {
    const { analytics, sent } = await sdk();
    const rc = revenueCat();
    const integration = connectRevenueCat(analytics, rc, { projectId: 'proj_test' });
    await integration.settled();
    rc.update(customer([])); // same customer: deduplicated
    rc.update(customer([]), 'customer-a'); // RevenueCat logIn
    await integration.settled();
    integration.dispose();
    rc.update(customer([]), 'customer-b');
    await integration.settled();
    await analytics.flush();
    expect(linked(sent)).toEqual(['$RCAnonymousID:first', 'customer-a']);
    expect(rc.listeners.size).toBe(0);
    await analytics.dispose();
  });

  it('reports access from the chosen entitlement and never lets older info win', async () => {
    const { analytics } = await sdk();
    const rc = revenueCat();
    let answer!: (info: RevenueCatCustomerInfo) => void;
    rc.info = new Promise((resolve) => (answer = resolve));
    const premium = connectRevenueCat(analytics, rc, {
      projectId: 'proj_test',
      entitlement: 'premium',
    });
    expect(premium.accessState()).toBe('unknown');
    answer(customer([], '2026-09-01T10:00:00.000Z'));
    await premium.settled();
    expect(premium.accessState()).toBe('inactive');
    rc.update(customer(['premium'], '2026-09-01T11:00:00.000Z'));
    expect(premium.accessState()).toBe('active');
    rc.update(customer([], '2026-09-01T10:30:00.000Z')); // older than what we have
    expect(premium.accessState()).toBe('active');
    rc.update(customer(['other'], '2026-09-01T12:00:00.000Z'));
    expect(premium.accessState()).toBe('inactive');
    const any = connectRevenueCat(analytics, rc, { projectId: 'proj_test' });
    await any.settled();
    expect(any.accessState()).toBe('active'); // any active entitlement counts by default
    await analytics.dispose();
  });

  it('records exactly the events of the manual paywall calls it replaces', async () => {
    // The manual pattern apps (Arch) wire today around Purchases.purchasePackage.
    async function manual() {
      const { analytics, sent } = await sdk();
      const view = (await analytics
        .paywall({ id: 'upgrade' })
        .view({ placement: 'settings', accessState: 'inactive', productIds: ['premium.annual'] }))!;
      const outcomes: PurchaseResult[] = [
        { result: 'succeeded', transactionId: 'tx-1' },
        { result: 'cancelled', errorCode: '1' },
        { result: 'pending', errorCode: '20' },
        { result: 'failed', errorCode: '2' },
      ];
      for (const outcome of outcomes)
        await (await view.purchaseStarted({ productId: 'premium.annual' }))!.finished(outcome);
      await analytics.linkRevenueCatUser({
        projectId: 'proj_test',
        getAppUserId: async () => '$RCAnonymousID:first',
      });
      await analytics.flush();
      return sent;
    }
    async function integrated() {
      const { analytics, sent } = await sdk();
      const rc = revenueCat();
      const integration = connectRevenueCat(analytics, rc, { projectId: 'proj_test' });
      await integration.settled();
      const view = (await analytics.paywall({ id: 'upgrade' }).view({
        placement: 'settings',
        accessState: integration.accessState(),
        productIds: ['premium.annual'],
      }))!;
      const store = [
        async () => purchased('tx-1'),
        async () => Promise.reject(rejected('1', true)),
        async () => Promise.reject(rejected('20')),
        async () => Promise.reject(rejected('2')),
      ];
      for (const call of store)
        await integration.purchase(view, 'premium.annual', call).catch(() => undefined);
      await integration.settled();
      await analytics.flush();
      return sent;
    }
    const shape = (events: AnalyticsEvent[]) =>
      events
        .map(({ name, properties }) => {
          const { paywall_view_id, purchase_attempt_id, ...rest } = properties;
          return { name, ...rest };
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(shape(await integrated())).toEqual(shape(await manual()));
  });

  it("returns RevenueCat's result and rethrows its error unchanged, mapping each outcome", async () => {
    const { analytics, sent } = await sdk();
    const integration = connectRevenueCat(analytics, revenueCat(), { projectId: 'proj_test' });
    const view = (await analytics
      .paywall({ id: 'upgrade' })
      .view({ placement: 'settings', productIds: ['premium.annual'] }))!;
    const result = purchased('tx-ok');
    expect(await integration.purchase(view, 'premium.annual', async () => result)).toBe(result);
    const noTransaction = { customerInfo: customer(['premium']), transaction: null };
    await integration.purchase(view, 'premium.annual', async () => noTransaction);
    for (const error of [
      rejected('1', true),
      rejected('20'),
      rejected('5'),
      new TypeError('bridge unavailable'),
    ])
      await expect(
        integration.purchase(view, 'premium.annual', () => Promise.reject(error)),
      ).rejects.toBe(error);
    await integration.settled();
    await analytics.flush();
    const results = sent
      .filter((e) => e.name === 'paywall_purchase_result')
      .map((e) => [e.properties.result, e.properties.transaction_id, e.properties.error_code]);
    expect(results).toEqual([
      ['succeeded', 'tx-ok', undefined],
      ['succeeded', undefined, undefined],
      ['cancelled', undefined, '1'],
      ['pending', undefined, '20'],
      ['failed', undefined, '5'],
      ['failed', undefined, undefined],
    ]);
    await analytics.dispose();
  });

  it('never holds checkout for analytics and still records the true start', async () => {
    const store = storage();
    const { analytics, sent } = await sdk({ storage: store });
    const rc = revenueCat();
    const integration = connectRevenueCat(analytics, rc, { projectId: 'proj_test' });
    await integration.settled();
    const view = (await analytics.paywall({ id: 'upgrade' }).view({ placement: 'settings' }))!;
    const release = store.hold(); // analytics storage stalls
    let checkoutStarted = false;
    const result = await integration.purchase(view, 'premium.annual', async () => {
      checkoutStarted = true;
      return purchased('tx-slow-disk');
    });
    expect(checkoutStarted).toBe(true);
    expect(result.transaction.transactionIdentifier).toBe('tx-slow-disk');
    release();
    await integration.settled();
    await analytics.flush();
    expect(sent.map((e) => e.name)).toEqual(
      expect.arrayContaining(['paywall_purchase_started', 'paywall_purchase_result']),
    );
    await analytics.dispose();
  });

  it('accepts a pending view, still purchases without one, and relinks after identify', async () => {
    const { analytics, sent } = await sdk();
    const rc = revenueCat();
    const integration = connectRevenueCat(analytics, rc, { projectId: 'proj_test' });
    await integration.settled();
    // Apps often hold the view as a promise while it is being recorded.
    const pending: Promise<PaywallView | null> = analytics
      .paywall({ id: 'upgrade' })
      .view({ placement: 'settings' });
    await integration.purchase(pending, { productId: 'premium.annual' }, async () =>
      purchased('tx-promise'),
    );
    // No view (analytics unavailable): checkout runs, nothing is recorded for it.
    const store = vi.fn(async () => purchased('tx-untracked'));
    expect((await integration.purchase(null, 'premium.annual', store)).transaction).toBeTruthy();
    expect(store).toHaveBeenCalledOnce();
    // identify() clears the RevenueCat link; the next purchase links the customer again.
    await analytics.identify('account-1');
    await integration.purchase(null, 'premium.annual', async () => purchased('tx-after-login'));
    await integration.settled();
    await analytics.flush();
    expect(
      sent
        .filter((e) => e.name === 'paywall_purchase_result')
        .map((e) => e.properties.transaction_id),
    ).toEqual(['tx-promise']);
    expect(linked(sent)).toEqual(['$RCAnonymousID:first', '$RCAnonymousID:first']);
    expect(sent.at(-1)).toMatchObject({ name: 'revenuecat_identity_linked', user_id: 'account-1' });
    await analytics.dispose();
  });

  it('rejects invalid options and keeps purchases working after dispose', async () => {
    const { analytics, sent } = await sdk();
    const rc = revenueCat();
    expect(() => connectRevenueCat(analytics, rc, { projectId: '' })).toThrow('project ID');
    expect(() =>
      connectRevenueCat(analytics, rc, { projectId: 'proj_test', entitlement: ' premium' }),
    ).toThrow('entitlement');
    const integration = connectRevenueCat(analytics, rc, { projectId: 'proj_test' });
    await integration.settled();
    integration.dispose();
    const view = (await analytics.paywall({ id: 'upgrade' }).view({ placement: 'settings' }))!;
    expect(
      (await integration.purchase(view, 'premium.annual', async () => purchased('tx-late')))
        .transaction.transactionIdentifier,
    ).toBe('tx-late');
    await analytics.flush();
    expect(sent.some((e) => e.name === 'paywall_purchase_started')).toBe(false);
    await analytics.dispose();
  });
});
