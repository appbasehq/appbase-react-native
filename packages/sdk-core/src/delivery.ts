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

/** HTTP supports delta seconds and dates. Cap untrusted delays at one day. */
export function retryDelay(value: string | null, now: number): number {
  if (!value?.trim()) return 0;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds)
    ? Math.max(0, Math.min(milliseconds, MOBILE_LIMITS.retryAfterMaximumMs))
    : 0;
}
