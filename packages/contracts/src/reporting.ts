/**
 * Reporting intervals over calendar days. `end` is exclusive; calendar buckets are clipped to the
 * range. Days are calendar dates; a report's time zone decides when each one starts.
 */
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

/** The bucket an instant falls in, with days starting at midnight in `zone`; -1 outside them. */
export function reportBucketIndex(at: number, buckets: ReportBucket[], zone = 'UTC'): number {
  let low = 0,
    high = buckets.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1,
      bucket = buckets[mid];
    if (at < zonedDayStart(bucket.date, zone)) high = mid - 1;
    else if (at >= zonedDayStart(bucket.end, zone)) low = mid + 1;
    else return mid;
  }
  return -1;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallClock(zone: string) {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, format);
  }
  return format;
}

/** Whether this is an IANA time zone name the runtime knows, such as `Europe/London`. */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(zone)) return false;
  try {
    wallClock(zone);
    return true;
  } catch {
    return false;
  }
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
function zoneOffset(at: number, zone: string) {
  const parts: Record<string, number> = {};
  for (const part of wallClock(zone).formatToParts(at)) parts[part.type] = Number(part.value);
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone. */
export function zonedDay(at: number | string | Date, zone = 'UTC'): string {
  const ms = typeof at === 'number' ? at : new Date(at).getTime();
  return date(zone === 'UTC' ? ms : ms + zoneOffset(ms, zone));
}

const starts = new Map<string, number>();
/**
 * The first instant of a calendar day in a time zone: its midnight, or the moment the clocks
 * change when they skip midnight.
 */
export function zonedDayStart(day: string, zone = 'UTC'): number {
  const midnight = Date.parse(day);
  if (zone === 'UTC') return midnight;
  const key = `${zone}|${day}`;
  const known = starts.get(key);
  if (known !== undefined) return known;
  // The offsets half a day either side: at most one clock change falls between them.
  const start = Math.min(
    ...[midnight - 43200000, midnight + 43200000]
      .map((near) => midnight - zoneOffset(near, zone))
      .filter((candidate) => zonedDay(candidate, zone) === day),
  );
  if (starts.size > 20000) starts.clear();
  starts.set(key, start);
  return start;
}
