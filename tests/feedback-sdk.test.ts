import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createReactNativeAnalytics,
  FeedbackError,
  type AnalyticsOptions,
} from '../sdks/react-native/src/index.js';
async function client(fetcher: typeof fetch, options: Partial<AnalyticsOptions> = {}) {
  const storage = new Map<string, string>();
  return createReactNativeAnalytics({
    appId: 'contact',
    environment: 'development',
    apiUrl: 'http://local',
    collectionKey: 'public-key',
    appVersion: '1.2',
    platform: 'test',
    generateId: randomUUID,
    flushIntervalMs: 0,
    storage: {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => {
        storage.set(key, value);
      },
    },
    fetch: fetcher,
    ...options,
  });
}
describe('Feedback SDK contract', () => {
  it('attaches identity and app context, keeps messages out of the event queue, omits a blank email', async () => {
    const requests: Record<string, unknown>[] = [];
    const sdk = await client(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return Response.json({ id: body.id, received_at: new Date().toISOString() });
    });
    await sdk.identify('reader-42');
    await sdk.feedback({ message: ' Hello team ', email: ' ' });
    expect(requests[0]).toMatchObject({
      message: 'Hello team',
      user_id: 'reader-42',
      anonymous_id: expect.any(String),
      platform: 'test',
      app_version: '1.2',
    });
    expect(requests[0]).not.toHaveProperty('email');
    // Feedback did not flush or append to the analytics batch.
    expect(requests).toHaveLength(1);
    await sdk.dispose();
  });
  it.each([400, 401, 409, 429, 503])(
    'rejects unsuccessful HTTP %s and keeps a retry ID',
    async (status) => {
      const sdk = await client(
        async () => new Response('{}', { status, headers: { 'Retry-After': '60' } }),
      );
      await expect(sdk.feedback({ message: 'Hello' })).rejects.toMatchObject({
        name: 'FeedbackError',
        submissionId: expect.any(String),
        ...(status === 429 ? { code: 'rate_limited', retryAfterSeconds: 60 } : {}),
      });
      await sdk.dispose();
    },
  );
  it('validates before sending, rejects a malformed acknowledgement and times out', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ id: randomUUID(), received_at: new Date().toISOString() }),
      );
    const sdk = await client(fetcher);
    await expect(sdk.feedback({ message: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(sdk.feedback({ message: 'Hi', email: 'not-email' })).rejects.toBeInstanceOf(
      FeedbackError,
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(sdk.feedback({ message: 'Hi' })).rejects.toMatchObject({ code: 'unavailable' });
    await sdk.dispose();
    const slow = await client(
      async (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
      { requestTimeoutMs: 20 },
    );
    await expect(slow.feedback({ message: 'Hello' })).rejects.toMatchObject({ code: 'network' });
    await slow.dispose();
  });
});
