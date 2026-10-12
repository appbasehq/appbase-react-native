import { reportBuckets, type ReportGranularity } from './reporting.js';
import type { AcquisitionReport, RevenueReport } from './types.js';

/** Outcomes of observed subscription trials, grouped by trial start, never acquisition. */
export interface TrialStartCounts {
  trials_started: number | null;
  trial_paid: number | null;
  trial_pending: number | null;
  /** Observed unsubscribe, without a later uncancellation, verified payment or expiration. */
  trial_cancelled: number | null;
  trial_ended: number | null;
  trial_unknown: number | null;
}
export interface TrialStartReport {
  totals: TrialStartCounts;
  series: (TrialStartCounts & { date: string })[];
  coverage: { excluded_starts: number; overdue_trials: number };
}
/** Positive transactions by payment date; conversion payments are not renewals. */
export interface PeriodPurchaseCounts {
  direct_purchases: number | null;
  trial_conversion_purchases: number | null;
  renewal_purchases: number | null;
  other_purchases: number | null;
}
export interface PeriodPurchaseReport {
  totals: PeriodPurchaseCounts;
  series: (PeriodPurchaseCounts & { date: string })[];
}
export interface PeriodOverviewCounts extends TrialStartCounts, PeriodPurchaseCounts {
  new_users: number | null;
  paid_purchases: number | null;
  net_revenue_cents: number | null;
}
export interface PeriodOverviewReport {
  from: string;
  to: string;
  granularity: ReportGranularity;
  as_of: string;
  currency: 'USD';
  totals: PeriodOverviewCounts;
  series: (PeriodOverviewCounts & { date: string })[];
  coverage: {
    new_users: 'observed' | 'partial' | 'unavailable';
    billing_status: RevenueReport['status'];
    history_complete: false;
    revenue: RevenueReport['coverage'];
    trials: TrialStartReport['coverage'];
  };
}

/** Compose independent populations. Never gate billing on new-user coverage or identity links. */
export function periodOverview(
  from: string,
  to: string,
  granularity: ReportGranularity,
  acquisition: AcquisitionReport,
  revenue: RevenueReport,
  trials: TrialStartReport,
  purchases: PeriodPurchaseReport,
): PeriodOverviewReport {
  const users = new Map(acquisition.series.map((point) => [point.date, point]));
  const payments = new Map(revenue.series.map((point) => [point.date, point]));
  const starts = new Map(trials.series.map((point) => [point.date, point]));
  const purchaseCounts = new Map(purchases.series.map((point) => [point.date, point]));
  const since = acquisition.new_user_since?.slice(0, 10);
  const series = reportBuckets(from, to, granularity).map(({ date, end }) => {
    const user = users.get(date),
      payment = payments.get(date),
      trial = starts.get(date);
    return {
      date,
      new_users:
        !since || end <= since || user?.acquisition_available === false
          ? null
          : (user?.new_users ?? null),
      paid_purchases: payment?.paid_transactions ?? null,
      direct_purchases: purchaseCounts.get(date)?.direct_purchases ?? null,
      trial_conversion_purchases: purchaseCounts.get(date)?.trial_conversion_purchases ?? null,
      renewal_purchases: purchaseCounts.get(date)?.renewal_purchases ?? null,
      other_purchases: purchaseCounts.get(date)?.other_purchases ?? null,
      net_revenue_cents: payment?.total_cents ?? null,
      trials_started: trial?.trials_started ?? null,
      trial_paid: trial?.trial_paid ?? null,
      trial_pending: trial?.trial_pending ?? null,
      trial_cancelled: trial?.trial_cancelled ?? null,
      trial_ended: trial?.trial_ended ?? null,
      trial_unknown: trial?.trial_unknown ?? null,
    };
  });
  const observed = series.filter((point) => point.new_users !== null);
  const partial =
    observed.length < series.length ||
    acquisition.historical_imports?.partial_range ||
    (since && since > from && since < to);
  return {
    from,
    to,
    granularity,
    as_of: revenue.as_of,
    currency: revenue.currency,
    totals: {
      // A partial observed total remains labelled partial; no coverage is unavailable, never zero.
      new_users: observed.length ? observed.reduce((sum, p) => sum + p.new_users!, 0) : null,
      paid_purchases: revenue.totals.paid_transactions,
      net_revenue_cents: revenue.totals.total_cents,
      ...trials.totals,
      ...purchases.totals,
    },
    series,
    coverage: {
      new_users: !observed.length ? 'unavailable' : partial ? 'partial' : 'observed',
      billing_status: revenue.status,
      history_complete: false,
      revenue: revenue.coverage,
      trials: trials.coverage,
    },
  };
}
