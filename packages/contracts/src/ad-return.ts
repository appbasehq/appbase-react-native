import { reportBucketIndex, type ReportBucket } from './reporting.js';
import type { AdReturnReport } from './types.js';

/**
 * Ad return: what ad spend bought, against what the people who first used the app on days with
 * ad spend have paid so far, and what their running trials pay if every one converts (full price,
 * not a prediction). Before store fees (as Revenue) unless the owner chose after them.
 *
 * Only days with spend count ("ad days"): new users on days without ads very likely did not come
 * from an ad, so their payments are reported separately and left out. It is still blended: some
 * people on ad days came without an ad. First payments only, so a lower bound that grows.
 */
export type AdReturnDay = {
  date: string;
  /** Spend in the ad account's currency (decides whether it is an ad day); null when unknown. */
  spend: number | null;
  /** The same in USD; null without an exchange rate. */
  spend_usd: number | null;
  new_users: number | null;
  /** Trial starters and paying users (direct or after a trial) among that day's new users. */
  trial_starters: number | null;
  payers: number | null;
  /** First payments before store fees, USD; null when billing is unknown. */
  paid: number | null;
  /** The same after store commission and tax; null when a payment lacks the fee fields. */
  paid_after_fees: number | null;
  /** Trials still running (auto-renew on) among that day's new users, by plan and currency. */
  pending: { product: string | null; currency: string | null; count: number }[] | null;
  /** Trials set to cancel among that day's new users: not counted. */
  cancelled: number | null;
};
/** Ad return shows money before store fees (as Revenue does) unless the owner chose after. */
export type AdReturnFees = 'before' | 'after';

/** Full prices for running trials; see `AdReturnReport['prices']`. */
export type AdReturnPrices = AdReturnReport['prices'];

const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
const round = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

/**
 * A running trial's full price: its plan's latest payment in the trial's currency, else the
 * plan's average payment, else the average across plans. Null when nothing has been paid.
 */
export function trialPrice(
  prices: AdReturnPrices,
  product: string | null,
  currency: string | null,
  fees: AdReturnFees = 'before',
) {
  const pick = (p: { price: number; kept: number | null } | undefined) =>
    p && (fees === 'after' ? p.kept : p.price);
  const latest = prices.by_currency.find((p) => p.product === product && p.currency === currency);
  const plan = prices.products.find((p) => p.product === product);
  if (latest) return pick(latest) ?? null;
  if (plan) return pick(plan) ?? null;
  return fees === 'after' ? prices.fallback_kept : prices.fallback_price;
}

export function buildAdReturn(
  days: AdReturnDay[],
  buckets: ReportBucket[],
  prices: AdReturnPrices,
  fees: AdReturnFees = 'before',
): AdReturnReport {
  const paidOf = (day: AdReturnDay) => (fees === 'after' ? day.paid_after_fees : day.paid);
  const points = buckets.map((b) => ({
    date: b.date,
    spend: 0 as number | null,
    paid: 0 as number | null,
    paid_without_ads: 0 as number | null,
    trial_value: 0 as number | null,
    trials: 0,
    cancelled_trials: 0,
  }));
  const total = {
    spend: 0 as number | null,
    paid: 0 as number | null,
    trial_value: 0 as number | null,
    running_trials: 0,
    cancelled_trials: 0,
    new_users: 0 as number | null,
    trial_starters: 0 as number | null,
    payers: 0 as number | null,
  };
  const excluded = { days: 0, new_users: 0 as number | null, paid: 0 as number | null };
  for (const day of days) {
    const index = reportBucketIndex(Date.parse(day.date), buckets);
    if (index < 0) continue;
    const point = points[index];
    // Unknown spend (before the copied range) is neither an ad day nor a day without ads.
    if (day.spend === null) {
      point.spend = null;
      total.spend = null;
      continue;
    }
    if (day.spend <= 0) {
      excluded.days++;
      excluded.new_users = add(excluded.new_users, day.new_users);
      excluded.paid = add(excluded.paid, paidOf(day));
      point.paid_without_ads = add(point.paid_without_ads, paidOf(day));
      continue;
    }
    const value =
      day.pending === null
        ? null
        : day.pending.reduce<number | null>((sum, { product, currency, count }) => {
            const each = trialPrice(prices, product, currency, fees);
            return count === 0 ? sum : add(sum, each === null ? null : each * count);
          }, 0);
    const running = day.pending?.reduce((sum, p) => sum + p.count, 0) ?? 0;
    point.spend = add(point.spend, day.spend_usd);
    point.paid = add(point.paid, paidOf(day));
    point.trial_value = add(point.trial_value, value);
    point.trials += running;
    point.cancelled_trials += day.cancelled ?? 0;
    total.spend = add(total.spend, day.spend_usd);
    total.paid = add(total.paid, paidOf(day));
    total.trial_value = add(total.trial_value, value);
    total.running_trials += running;
    total.cancelled_trials += day.cancelled ?? 0;
    total.new_users = add(total.new_users, day.new_users);
    total.trial_starters = add(total.trial_starters, day.trial_starters);
    total.payers = add(total.payers, day.payers);
  }
  const spend = total.spend;
  return {
    basis: 'ad_days',
    fees,
    points: points.map((p) => ({
      ...p,
      spend: round(p.spend),
      paid: round(p.paid),
      paid_without_ads: round(p.paid_without_ads),
      trial_value: round(p.trial_value),
    })),
    total: {
      ...total,
      spend: round(total.spend),
      paid: round(total.paid),
      trial_value: round(total.trial_value),
    },
    excluded: { ...excluded, paid: round(excluded.paid) },
    prices,
    return_so_far: spend && total.paid !== null ? total.paid / spend : null,
    return_if_trials_pay:
      spend && total.paid !== null && total.trial_value !== null
        ? (total.paid + total.trial_value) / spend
        : null,
  };
}
