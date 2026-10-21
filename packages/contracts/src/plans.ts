/**
 * Appbase's own plans (what customers pay us), shared by the API and the web. Not a customer's
 * app billing, which this codebase calls "billing". See docs/planning/plans-and-usage.md.
 */
export type PlanName = 'free' | 'solo' | 'portfolio' | 'internal';

export interface PlanTier {
  /** Stored on the account and used as the Stripe price lookup key suffix. */
  id: string;
  plan: PlanName;
  /** Events per period; null is unlimited. */
  events: number | null;
  /** Apps the account may have; null is unlimited. */
  apps: number | null;
  /** US dollars per month; null for plans that are not sold. */
  monthlyUsd: number | null;
}

/** The event volumes plans are sold at, smallest first. */
export const PLAN_VOLUMES = [
  { key: '10k', events: 10_000, label: '10k' },
  { key: '100k', events: 100_000, label: '100k' },
  { key: '200k', events: 200_000, label: '200k' },
  { key: '500k', events: 500_000, label: '500k' },
  { key: '1m', events: 1_000_000, label: '1M' },
] as const;
export type PlanVolume = (typeof PLAN_VOLUMES)[number]['key'];

const paid = (
  plan: 'solo' | 'portfolio',
  apps: number | null,
  prices: Partial<Record<PlanVolume, number>>,
) =>
  PLAN_VOLUMES.filter(({ key }) => prices[key] !== undefined).map(({ key, events }): PlanTier => ({
    id: `${plan}_${key}`,
    plan,
    events,
    apps,
    monthlyUsd: prices[key]!,
  }));

export const PLAN_TIERS: readonly PlanTier[] = [
  // Solo at 10k events is Free.
  { id: 'free', plan: 'free', events: 10_000, apps: 1, monthlyUsd: 0 },
  ...paid('solo', 1, { '100k': 19, '200k': 29, '500k': 49, '1m': 69 }),
  ...paid('portfolio', null, { '10k': 19, '100k': 39, '200k': 59, '500k': 99, '1m': 139 }),
  { id: 'internal', plan: 'internal', events: null, apps: null, monthlyUsd: null },
  // No longer sold; kept so a subscription still on one keeps its limits.
  { id: 'solo_2m', plan: 'solo', events: 2_000_000, apps: 1, monthlyUsd: null },
  { id: 'portfolio_2m', plan: 'portfolio', events: 2_000_000, apps: null, monthlyUsd: null },
];

export const FREE_TIER = PLAN_TIERS[0]!;

/** The tier a plan has at a volume: Solo at the smallest is Free. */
export function tierAt(plan: 'solo' | 'portfolio', volume: PlanVolume): PlanTier {
  if (plan === 'solo' && volume === '10k') return FREE_TIER;
  return PLAN_TIERS.find((tier) => tier.id === `${plan}_${volume}` && tier.monthlyUsd)!;
}

/** The volume a tier is sold at (Free and Internal at the smallest). */
export function volumeOf(tier: PlanTier): PlanVolume {
  return PLAN_VOLUMES.find(({ key }) => tier.id.endsWith(`_${key}`))?.key ?? '10k';
}

export function planTier(id: string | null | undefined): PlanTier | undefined {
  return PLAN_TIERS.find((tier) => tier.id === id);
}

/** Stripe price lookup key for a sold tier: the setup script creates prices under these. */
export const stripeLookupKey = (tierId: string) => `appbase_${tierId}_monthly`;

export function tierForLookupKey(key: string | null | undefined): PlanTier | undefined {
  const match = /^appbase_([a-z0-9_]+)_monthly$/.exec(key ?? '');
  const tier = planTier(match?.[1]);
  return tier && tier.monthlyUsd ? tier : undefined;
}

/**
 * The tier a Stripe price belongs to. Prices carry `appbase_tier` metadata from the setup script,
 * which outlives a price change (the lookup key moves to the new price; subscribers keep the old
 * one) and a tier no longer sold; the lookup key covers older prices.
 */
export function tierForPrice(price: {
  lookup_key?: string | null;
  metadata?: Record<string, string> | null;
}): PlanTier | undefined {
  const tier = planTier(price.metadata?.appbase_tier);
  if (tier && (tier.plan === 'solo' || tier.plan === 'portfolio')) return tier;
  return tierForLookupKey(price.lookup_key);
}

/** Share of the period's events at which each step applies. */
export const PLAN_THRESHOLDS = { warning: 0.8, locked: 1, paused: 1.2 } as const;

/**
 * - `ok`: under 80%.
 * - `warning`: 80% or more of the period's events.
 * - `locked`: over the limit; reports and agent analytics answer HTTP 402.
 * - `paused`: at 120%; collection answers HTTP 429 until the period ends or the plan grows.
 */
export type PlanUsageStatus = 'ok' | 'warning' | 'locked' | 'paused';

export function usageStatus(events: number, limit: number | null): PlanUsageStatus {
  if (limit === null) return 'ok';
  if (events >= Math.ceil(limit * PLAN_THRESHOLDS.paused)) return 'paused';
  if (events > limit) return 'locked';
  if (events >= Math.ceil(limit * PLAN_THRESHOLDS.warning)) return 'warning';
  return 'ok';
}

/** One of the account's apps on its plan. Reports of apps the plan does not include are locked. */
export interface AccountPlanApp {
  id: string;
  /** Events received this period that count toward the plan. */
  events: number;
  /** The latest event received from any build, if any. */
  last_received_at: string | null;
  included: boolean;
}

/** The account's plan as `GET /v1/admin/plan` reports it. */
export interface AccountPlanSummary {
  tier: PlanTier;
  /** Stripe subscription status for paid plans (for example `active` or `past_due`). */
  subscription_status: string | null;
  cancel_at_period_end: boolean;
  period: { start: string; end: string };
  usage: {
    events: number;
    status: PlanUsageStatus;
    /** When usage reaches the limit at the period's pace so far, if before the period ends. */
    limit_expected_at: string | null;
  };
  apps: {
    count: number;
    limit: number | null;
    locked_app_ids: string[];
    /** Included apps first: the ones chosen most recently, then the oldest. */
    items: AccountPlanApp[];
  };
  /** False when Stripe is not configured on this API. */
  checkout_available: boolean;
}
