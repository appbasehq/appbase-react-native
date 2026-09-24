import { MOBILE_LIMITS } from '@mobile-analytics/contracts/mobile-constants';
import type { Properties } from '@mobile-analytics/contracts/types';

export function snapshotProperties(properties: Properties): Properties {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

export function validProperties(properties: Properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
  const valid =
    Object.keys(properties).length <= MOBILE_LIMITS.propertyCount &&
    Object.keys(properties).every(
      (k) => k.length > 0 && k.length <= MOBILE_LIMITS.propertyKeyLength,
    ) &&
    Object.values(properties).every(
      (v) =>
        v === null ||
        typeof v === 'boolean' ||
        (typeof v === 'number' && Number.isFinite(v)) ||
        (typeof v === 'string' && v.length <= MOBILE_LIMITS.propertyStringLength) ||
        (Array.isArray(v) &&
          v.length <= MOBILE_LIMITS.propertyArrayLength &&
          v.every(
            (s) => typeof s === 'string' && s.length <= MOBILE_LIMITS.propertyArrayStringLength,
          )),
    );
  if (!valid) return false;
  return jsonBytes(properties) <= MOBILE_LIMITS.propertiesBytes;
}

// JSON escapes lone surrogates. Count UTF-8 bytes without requiring a native TextEncoder.
export function jsonBytes(value: unknown) {
  let bytes = 0;
  for (const char of JSON.stringify(value)) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
