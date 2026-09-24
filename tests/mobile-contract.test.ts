import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eventSchema } from '../packages/contracts/src/index.js';
import { feedbackSubmissionSchema } from '../packages/contracts/src/mobile-feedback.js';
import { batchResultSchema } from '../packages/contracts/src/mobile-response.js';
import { mobileContractArtifacts } from '../packages/contracts/src/mobile-schema.js';
import { createReactNativeAnalytics } from '../sdks/react-native/src/index.js';
import { jsonBytes, validProperties } from '../packages/sdk-core/src/properties.js';

const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../packages/contracts/mobile/${name}`, import.meta.url), 'utf8'),
  );
const vectors = read('validation-vectors.json') as {
  version: number;
  vectors: { id: string; valid: boolean; event: unknown }[];
};
const fingerprints = read('fingerprint-vectors.json') as {
  version: number;
  vectors: { id: string; definition: { steps: string[]; questions?: any[] }; expected: string }[];
};

describe('canonical mobile contract', () => {
  it.each(
    read('vectors/property-bytes.json') as {
      id: string;
      properties: never;
      utf8Bytes: number;
      valid: boolean;
    }[],
  )('serialized property bytes: $id', ({ properties, utf8Bytes, valid }) => {
    expect(jsonBytes(properties)).toBe(utf8Bytes);
    expect(validProperties(properties)).toBe(valid);
  });
  it('keeps every generated structural artifact synchronized with canonical runtime schemas', () => {
    for (const [name, generated] of Object.entries(mobileContractArtifacts()))
      expect(read(name), name).toEqual(generated);
  });
  it.each(vectors.vectors)('$id accepts=$valid', ({ valid, event }) => {
    expect(vectors.version).toBe(1);
    expect(eventSchema.safeParse(event).success).toBe(valid);
  });
  it.each(fingerprints.vectors)('automatic version: $id', async ({ definition, expected }) => {
    expect(fingerprints.version).toBe(1);
    let id = 0;
    const sdk = await createReactNativeAnalytics({
      appId: 'fingerprints',
      environment: 'development',
      collectionKey: 'public-fixture-key',
      apiUrl: 'https://conformance.invalid',
      platform: 'test',
      appVersion: '1.0.0',
      storage: { getItem: async () => null, setItem: async () => {} },
      generateId: () => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}`,
      flushIntervalMs: 0,
    });
    try {
      expect(sdk.onboarding({ id: 'fixture', ...definition }).definition.version).toBe(expected);
    } finally {
      await sdk.dispose();
    }
  });
  it('preserves feedback normalization and control-character validation', () => {
    const input = {
      id: '10000000-0000-4000-8000-000000000001',
      message: '  Hello  ',
      platform: 'ios',
      app_version: '1.0.0',
    };
    expect(feedbackSubmissionSchema.parse(input).message).toBe('Hello');
    expect(feedbackSubmissionSchema.safeParse({ ...input, message: 'bad\0message' }).success).toBe(
      false,
    );
    expect(feedbackSubmissionSchema.safeParse({ ...input, user_id: 'bad\nidentity' }).success).toBe(
      false,
    );
    expect(feedbackSubmissionSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });
  it('retains conservative UTF-16 client limits without narrowing historical server acceptance', () => {
    const properties = { emoji: '🎉'.repeat(1001) };
    expect(validProperties(properties)).toBe(false);
    const base = vectors.vectors.find((vector) => vector.id === 'flat-event')!.event as object;
    expect(eventSchema.safeParse({ ...base, properties }).success).toBe(true);
  });
  it('retains the server wire response for malformed events without endorsing removal by null ID', () => {
    expect(
      batchResultSchema.safeParse({
        accepted: [],
        rejected: [{ event_id: null, reason: 'Invalid event' }],
      }).success,
    ).toBe(true);
    expect(batchResultSchema.safeParse({ accepted: ['not-an-id'], rejected: [] }).success).toBe(
      false,
    );
  });
});
