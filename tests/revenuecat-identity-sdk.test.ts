import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createReactNativeAnalytics,
  type AnalyticsEvent,
  type AnalyticsOptions,
  type Diagnostic,
} from '../sdks/react-native/src/index.js';
function harness(extra: Partial<AnalyticsOptions> = {}) {
  const data = new Map<string, string>(),
    received: AnalyticsEvent[] = [],
    diagnostics: Diagnostic[] = [];
  let failStorage = false,
    offline = false;
  const options: AnalyticsOptions = {
    appId: 'identity-test',
    environment: 'development',
    apiUrl: 'http://localhost:4400',
    collectionKey: 'test',
    platform: 'test',
    appVersion: 'test',
    generateId: randomUUID,
    flushIntervalMs: 0,
    onDiagnostic: (d) => diagnostics.push(d),
    storage: {
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        if (failStorage) throw Error('disk');
        data.set(k, v);
      },
    },
    fetch: async (_url, init) => {
      if (offline) throw Error('offline');
      const events = JSON.parse(String(init?.body)).events as AnalyticsEvent[];
      received.push(...events);
      return new Response(
        JSON.stringify({ accepted: events.map((e) => e.event_id), rejected: [] }),
      );
    },
    ...extra,
  };
  return {
    options,
    received,
    diagnostics,
    data,
    failStorage: (v: boolean) => {
      failStorage = v;
    },
    offline: (v: boolean) => {
      offline = v;
    },
  };
}
const link = (
  sdk: Awaited<ReturnType<typeof createReactNativeAnalytics>>,
  id = 'rc-anonymous',
  projectId = 'project-1',
) => sdk.linkRevenueCatUser({ projectId, getAppUserId: async () => id });
function deferred() {
  let resolve!: (v: string) => void, entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const value = new Promise<string>((r) => {
    resolve = r;
  });
  return {
    resolve,
    started,
    get: () => {
      entered();
      return value;
    },
  };
}
describe('RevenueCat SDK identity evidence', () => {
  it('persists and deduplicates links across restart and offline delivery with original identity', async () => {
    const h = harness();
    h.offline(true);
    let sdk = await createReactNativeAnalytics(h.options);
    const before = await sdk.getIdentity();
    const id = await link(sdk);
    expect(id).toBeTruthy();
    expect(await link(sdk)).toBe(id);
    await sdk.flush();
    await sdk.dispose();
    sdk = await createReactNativeAnalytics(h.options);
    expect(await link(sdk)).toBe(id);
    await sdk.identify('account-1');
    const identified = await link(sdk);
    expect(identified).not.toBe(id);
    await sdk.reset();
    const after = await sdk.getIdentity();
    await link(sdk, 'new-rc-anonymous');
    h.offline(false);
    await sdk.resume();
    const links = h.received.filter((e) => e.name === 'revenuecat_identity_linked');
    expect(links).toHaveLength(3);
    expect(links[0]).toMatchObject({
      event_id: id,
      anonymous_id: before.anonymousId,
      properties: {
        revenuecat_project_id: 'project-1',
        revenuecat_app_user_id: 'rc-anonymous',
        link_source: 'client',
      },
    });
    expect(links[0].user_id).toBeUndefined();
    expect(links[1]).toMatchObject({ anonymous_id: before.anonymousId, user_id: 'account-1' });
    expect(links[2]).toMatchObject({
      anonymous_id: after.anonymousId,
      installation_id: before.installationId,
    });
    expect(links[2].user_id).toBeUndefined();
    await sdk.dispose();
  });
  it('rejects slow lookups across identify, reset, opt-out/re-enable, and disposal without blocking tracking', async () => {
    for (const change of ['identify', 'reset', 'opt-out', 'dispose']) {
      const h = harness(),
        sdk = await createReactNativeAnalytics(h.options),
        d = deferred();
      const pending = sdk.linkRevenueCatUser({ projectId: 'project-1', getAppUserId: d.get });
      await d.started;
      await sdk.track('still_responsive');
      if (change === 'identify') await sdk.identify('account-1');
      if (change === 'reset') await sdk.reset();
      if (change === 'opt-out') {
        await sdk.setEnabled(false);
        await sdk.setEnabled(true);
      }
      if (change === 'dispose') await sdk.dispose();
      d.resolve('old-rc-id');
      expect(await pending).toBeNull();
      const stored = JSON.parse([...h.data.values()][0]);
      expect(
        stored.events.some((e: AnalyticsEvent) => e.name === 'revenuecat_identity_linked'),
      ).toBe(false);
      expect(h.diagnostics.at(-1)?.message).toContain('identity changed');
      await sdk.dispose();
    }
  });
  it('deduplicates concurrent callbacks, keeps projects distinct and snapshots caller options', async () => {
    const h = harness(),
      sdk = await createReactNativeAnalytics(h.options),
      d = deferred();
    const mutable = { projectId: 'project-1', getAppUserId: d.get };
    const pending = sdk.linkRevenueCatUser(mutable);
    mutable.projectId = 'mutated';
    await d.started;
    const second = await link(sdk);
    d.resolve('rc-anonymous');
    expect(await pending).toBe(second);
    expect(await link(sdk, 'rc-anonymous', 'project-2')).not.toBe(second);
    await sdk.flush();
    expect(
      h.received
        .filter((e) => e.name === 'revenuecat_identity_linked')
        .map((e) => e.properties.revenuecat_project_id),
    ).toEqual(['project-1', 'project-2']);
    await sdk.dispose();
  });
  it('does not record success on queue/storage failure and can retry after recovery', async () => {
    const h = harness({ maxQueueSize: 1 }),
      sdk = await createReactNativeAnalytics(h.options);
    expect(await link(sdk)).toBeNull();
    await sdk.flush();
    h.failStorage(true);
    expect(await link(sdk)).toBeNull();
    h.failStorage(false);
    const id = await link(sdk);
    expect(id).toBeTruthy();
    await sdk.flush();
    expect(h.received.filter((e) => e.name === 'revenuecat_identity_linked')).toHaveLength(1);
    expect(h.diagnostics.map((d) => d.code)).toEqual(['queue_full', 'storage']);
    await sdk.dispose();
  });
  it('validates opaque IDs, contains lookup errors and skips lookup while collection is disabled', async () => {
    const h = harness(),
      sdk = await createReactNativeAnalytics(h.options);
    for (const bad of ['', ' spaced ', 'x'.repeat(256), 'x\0y', '\uD800'])
      expect(await link(sdk, bad)).toBeNull();
    expect(await link(sdk, 'valid', '')).toBeNull();
    expect(
      await sdk.linkRevenueCatUser({
        projectId: 'project-1',
        getAppUserId: async () => {
          throw Error('sensitive-provider-error');
        },
      }),
    ).toBeNull();
    expect(JSON.stringify(h.diagnostics)).not.toContain('sensitive-provider-error');
    await sdk.setEnabled(false);
    let invoked = false;
    expect(
      await sdk.linkRevenueCatUser({
        projectId: 'project-1',
        getAppUserId: async () => {
          invoked = true;
          return 'valid';
        },
      }),
    ).toBeNull();
    expect(invoked).toBe(false);
    await sdk.setEnabled(true);
    expect(await link(sdk, '客户🌱')).toBeTruthy();
    await sdk.dispose();
  });
});
