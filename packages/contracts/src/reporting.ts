/** UTC reporting intervals. `end` is exclusive; calendar buckets are clipped to the range. */
export const reportGranularities = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type ReportGranularity = (typeof reportGranularities)[number];
/** Optional HTTP report selection. Omission retains the complete legacy report. */
export const reportViews = [
  'new-business',
  'revenue',
  'subscriptions',
  'onboarding',
  'paywalls',
  'app-health',
  'features',
  'audience',
  'users',
  'acquisition',
] as const;
export type ReportView = (typeof reportViews)[number];
export interface ReportBucket {
  date: string;
  end: string;
}
const DAY = 86400000;
const date = (at: number) => new Date(at).toISOString().slice(0, 10);
export const MAX_CHART_POINTS = 800;

export function reportBuckets(
  from: string,
  to: string,
  granularity: ReportGranularity,
): ReportBucket[] {
  const buckets: ReportBucket[] = [];
  const until = Date.parse(to);
  for (let at = Date.parse(from); at < until;) {
    const d = new Date(at);
    const next =
      granularity === 'yearly'
        ? Date.UTC(d.getUTCFullYear() + 1, 0, 1)
        : granularity === 'monthly'
          ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
          : at + DAY * (granularity === 'weekly' ? 7 : 1);
    const end = Math.min(next, until);
    buckets.push({ date: date(at), end: date(end) });
    at = end;
  }
  return buckets;
}

/** Reduce chart density, never the date range or totals. */
export function reportGranularity(
  from: string,
  to: string,
  requested: ReportGranularity,
): ReportGranularity {
  for (const interval of reportGranularities.slice(reportGranularities.indexOf(requested))) {
    if (interval === 'yearly') return interval;
    const days = (Date.parse(to) - Date.parse(from)) / DAY;
    const points =
      interval === 'daily'
        ? days
        : interval === 'weekly'
          ? Math.ceil(days / 7)
          : (new Date(Date.parse(to) - 1).getUTCFullYear() - new Date(from).getUTCFullYear()) * 12 +
            new Date(Date.parse(to) - 1).getUTCMonth() -
            new Date(from).getUTCMonth() +
            1;
    if (points <= MAX_CHART_POINTS) return interval;
  }
  return 'yearly';
}

export function reportBucketIndex(at: number, buckets: ReportBucket[]): number {
  let low = 0,
    high = buckets.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1,
      bucket = buckets[mid];
    if (at < Date.parse(bucket.date)) high = mid - 1;
    else if (at >= Date.parse(bucket.end)) low = mid + 1;
    else return mid;
  }
  return -1;
}
