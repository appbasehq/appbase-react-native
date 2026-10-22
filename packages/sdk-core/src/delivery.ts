import type { BatchResult } from '@mobile-analytics/contracts/types';
import { MOBILE_LIMITS } from '@mobile-analytics/contracts/mobile-constants';

/** Treat acknowledgements as untrusted. Ambiguous receipts must never delete local events. */
export function acknowledgedIds(value: unknown, sent: ReadonlySet<string>): Set<string> {
  if (!value || typeof value !== 'object') throw new Error('Invalid acknowledgement');
  const ack = value as BatchResult;
  if (
    !Array.isArray(ack.accepted) ||
    !Array.isArray(ack.rejected) ||
    ack.accepted.some((id) => typeof id !== 'string') ||
    ack.rejected.some((r) => !r || typeof r.event_id !== 'string' || typeof r.reason !== 'string')
  )
    throw new Error('Invalid acknowledgement');
  const listed = [...ack.accepted, ...ack.rejected.map((r) => r.event_id!)];
  if (listed.some((id) => !id || !sent.has(id)))
    throw new Error('Acknowledgement includes unknown events');
  const ids = new Set(listed);
  if (!ids.size || ids.size !== listed.length)
    throw new Error('Acknowledgement is empty or ambiguous');
  return ids;
}

/**
 * What a batch response means for the queue: the one status table in behavior.md. Redirects are
 * never followed (credentials and payloads must not move to another endpoint).
 */
export function responseKind(
  status: number,
  redirected = false,
): 'ack' | 'split' | 'retry' | 'blocked' | 'gone' {
  if (redirected || (status >= 300 && status < 400)) return 'blocked';
  if (status >= 200 && status < 300) return 'ack';
  if (status === 410) return 'gone';
  if (status === 400 || status === 413) return 'split';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return status >= 400 ? 'blocked' : 'retry';
}

/** Full jitter: uniformly random up to the exponential ceiling, so a fleet that failed together
 * does not retry together; at least one second, at most retryMaximumMs. */
export function backoffDelay(failures: number, random = Math.random()): number {
  const ceiling = Math.min(
    MOBILE_LIMITS.retryMaximumMs,
    MOBILE_LIMITS.retryBaseMs * 2 ** Math.min(Math.max(failures, 1) - 1, 20),
  );
  return Math.max(1000, Math.floor(random * ceiling));
}

/** A short non-secret fingerprint (FNV-1a over UTF-16 units) so stored delivery state follows its key. */
export function keyFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** HTTP supports delta seconds and dates. Cap untrusted delays at one day. */
export function retryDelay(value: string | null, now: number): number {
  if (!value?.trim()) return 0;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds)
    ? Math.max(0, Math.min(milliseconds, MOBILE_LIMITS.retryAfterMaximumMs))
    : 0;
}
