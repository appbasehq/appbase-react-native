import type { AcquisitionConfiguration } from './acquisition.js';
import type { ReportGranularity, ReportView } from './reporting.js';
/** Flat values; bounded string lists support displayed product IDs. */
export type Properties = Record<string, string | number | boolean | null | string[]>;
export interface OnboardingQuestion {
  id: string;
  stepId: string;
  title: string;
  type: 'single' | 'multiple';
  options: { id: string; label: string }[];
}
export interface OnboardingDefinition {
  id: string;
  version: string;
  steps: string[];
  questions?: OnboardingQuestion[];
}
export interface OnboardingAnswerSummary extends OnboardingQuestion {
  reached: number;
  answered: number;
  skipped: number;
  missing: number;
  conflicted: number;
  options: (OnboardingQuestion['options'][number] & { count: number })[];
}
export interface OnboardingAnswers {
  status: 'observed' | 'limited';
  questions: OnboardingAnswerSummary[];
}
/** Wire value captured by SDKs; Unknown is reported as Production. */
export type RuntimeEnvironment = 'production' | 'sandbox' | 'development' | 'unknown';
/** Production is the App Store plus anything without a detected build; Sandbox is TestFlight/App Review. */
export type ReportingEnvironment = 'production' | 'sandbox' | 'development';
export interface ReportingScope {
  id: string;
  environment: ReportingEnvironment;
  appId: string;
  from: string;
  to: string;
  asOf: string;
}

export interface AnalyticsEvent {
  schema_version: 1;
  event_id: string;
  installation_id: string;
  anonymous_id: string;
  user_id?: string;
  name: string;
  occurred_at: string;
  platform: 'ios' | 'android' | 'test';
  app_version: string;
  /** Native distribution signal at capture; absent on legacy clients. Separate from collection-key scope. */
  runtime_environment?: RuntimeEnvironment;
  properties: Properties;
  onboarding?: OnboardingDefinition;
}
export interface BatchResult {
  accepted: string[];
  rejected: { event_id: string | null; reason: string }[];
}
export interface AppRecord {
  id: string;
  name: string;
  slug: string;
  collection_enabled: boolean;
  /** Legacy configuration; reports use discovered flow definitions. */
  flow_id: string;
  flow_version: string;
  flow_steps: string[];
}
export interface AppSetup {
  app: AppRecord;
  events: number;
  last_received_at: string | null;
  /** Accounts linked by `identify`; zero suggests a forgotten call in an app with sign-in. */
  identified_users?: number;
  usage: IngestionUsage;
}
export interface AppCredentials {
  app: AppRecord;
  collection_key: string;
}
export interface UsageWindow {
  events: number;
  bytes: number;
  blocked_requests: number;
  event_limit: number;
  byte_limit: number;
  resets_at: string;
}
export interface IngestionUsage {
  app: { minute: UsageWindow; day: UsageWindow };
  service: { minute: UsageWindow; day: UsageWindow };
}
export interface Report {
  reporting_scope?: ReportingScope;
  /** Owner-marked testers left out of this Production read (0 elsewhere). */
  testers_excluded?: number;
  /** Production only: installs active in range that never reported a build (older app versions,
   * Android) and therefore count as Production. 0 elsewhere. */
  unverified_builds?: number;
  app: AppRecord;
  from: string;
  to: string;
  generated_at: string;
  totals: { events: number; active_users: number; last_received_at: string | null };
  onboarding: { label: string; count: number }[];
  onboarding_answers: OnboardingAnswers;
  flows: OnboardingDefinition[];
  flow: OnboardingDefinition | null;
  retention: { cohort: string; users: number; d1: number | null; d7: number | null }[];
  paywalls: { placement: string; version: string; exposures: number; viewers: number }[];
  paywall_journeys: PaywallJourneys;
  recent: StoredEvent[];
  dashboard: DashboardStats;
  app_health: AppHealthReport;
  acquisition: AcquisitionReport;
  revenue: RevenueReport;
}

/** A selected report omits unrelated fields; omission never means measured zero. */
type ReportViewFields = {
  'new-business': Pick<Report, 'acquisition'>;
  revenue: Pick<Report, 'revenue'>;
  subscriptions: Pick<Report, 'revenue'>;
  onboarding: Pick<
    Report,
    'onboarding' | 'onboarding_answers' | 'flows' | 'flow' | 'paywall_journeys'
  >;
  paywalls: Pick<Report, 'paywall_journeys'>;
  'app-health': Pick<Report, 'app_health'>;
  features: { dashboard: Pick<DashboardStats, 'features'> };
  audience: {
    dashboard: Pick<DashboardStats, 'platforms' | 'versions' | 'total_users' | 'countries'>;
  };
  users: Pick<Report, 'recent'> & { dashboard: Pick<DashboardStats, 'users' | 'total_users'> };
  acquisition: Record<never, never>;
};
export type ReportViewResult<V extends ReportView = ReportView> = {
  [K in V]: Pick<
    Report,
    | 'app'
    | 'from'
    | 'to'
    | 'generated_at'
    | 'reporting_scope'
    | 'testers_excluded'
    | 'unverified_builds'
  > & {
    view: K;
    dashboard: Pick<DashboardStats, 'granularity'>;
  } & ReportViewFields[K];
}[V];

export type ActivityWindow = 'dau' | 'wau' | 'mau';
export interface ActiveUsers {
  active: number;
  new_users: number;
  existing_users: number;
  unknown_users: number;
}
export interface AppHealthPoint {
  date: string;
  dau: ActiveUsers | null;
  wau: ActiveUsers | null;
  mau: ActiveUsers | null;
}
export type RetentionDay = 1 | 7 | 14 | 30;
export interface RetentionCell {
  day: RetentionDay;
  eligible: number;
  returned: number | null;
}
export interface RetentionCohort {
  week: string;
  from: string;
  to: string;
  users: number;
  cells: RetentionCell[];
}
export interface AppHealthReport {
  new_user_definition: AcquisitionConfiguration;
  /** First matching configured event; not a promise of complete coverage. */
  new_user_since: string | null;
  activity_as_of: string | null;
  activity: AppHealthPoint[];
  retention: {
    users: number;
    summary: RetentionCell[];
    cohorts: RetentionCohort[];
  };
}

export interface PaywallConversions {
  // Union of trial starters and direct purchasers, once per viewer or onboarding attempt.
  subscriptions_started: number | null;
  trials_started: number | null;
  direct_paid: number | null;
  trial_paid: number | null;
  trial_pending: number | null;
  trial_ended: number | null;
  trial_unknown: number | null;
  paying_customers: number | null;
}
export interface PaywallMetrics extends PaywallConversions {
  views: number;
  viewers: number;
  // Null when any presentation has unknown access; never assume missing history means free.
  eligible_viewers: number | null;
  subscriber_views: number;
  subscriber_viewers: number;
  unknown_access_views: number;
  unknown_access_viewers: number;
  interested_viewers: number;
  reported_success_viewers: number;
  dismissed_views: number;
  purchase_attempts: number;
  failed_attempts: number;
  cancelled_attempts: number;
  pending_attempts: number;
}
export interface PaywallPlacement extends PaywallMetrics {
  key: string;
  paywall_id: string;
  version: string;
  placement: string;
  onboarding_attempts: number;
  first_attempts: number;
  additional_attempts: number;
  onboarding_conversions: PaywallConversions;
}
export interface PaywallSlice {
  key: string;
  paywall_id: string | null;
  version: string | null;
  totals: PaywallMetrics;
  placements: PaywallPlacement[];
}
/** Exclusive routes: each viewer's earliest verified start in the selected view cohort.
 * Ties use presentation time, trial before direct, then stable presentation ID. */
export interface PaywallStartBreakdown {
  trials: number | null;
  direct: number | null;
}
export interface PaywallStartPoint extends PaywallStartBreakdown {
  date: string;
  starts: number | null;
}
export interface PaywallComparisonPlacement extends Omit<
  PaywallPlacement,
  'onboarding_attempts' | 'first_attempts' | 'additional_attempts' | 'onboarding_conversions'
> {
  context: 'onboarding' | 'in_app';
  starts_by_type: PaywallStartBreakdown;
}
export interface PaywallComparisonSlice extends Omit<PaywallSlice, 'placements'> {
  starts_by_type: PaywallStartBreakdown;
  series: PaywallStartPoint[];
  placements: PaywallComparisonPlacement[];
}
export interface OnboardingFunnelStage {
  label: string;
  kind: 'start' | 'step' | 'completion' | 'paywall' | 'subscription';
  count: number | null;
}
export interface OnboardingPaywallFunnel {
  stages: OnboardingFunnelStage[];
  conversions: PaywallConversions;
  // Linked paywall attempts that did not first reach every configured step in order.
  excluded_attempts: number;
}
export interface PaywallJourneys {
  granularity: ReportGranularity;
  status: 'observed' | 'limited';
  attribution: 'unconnected' | 'observed' | 'limited';
  billing: {
    as_of: string;
    history_complete: false;
    connection_enabled: boolean;
    // Successful callbacks or pending callbacks with transaction IDs in selected cohorts, counted as attempts.
    matched_successes: number;
    unmatched_successes: number;
    missing_transaction_ids: number;
    ambiguous_successes: number;
    // Provider starts by purchase date, across all paywalls/flows in this app and environment.
    unattributed_starts: number;
  };
  // All valid presentations by view date, independent of the selected onboarding flow.
  all: PaywallComparisonSlice[];
  in_app: PaywallSlice[];
  onboarding: {
    started_attempts: number;
    reached_attempts: number;
    additional_attempts: number;
    conversions: PaywallConversions;
    placements: PaywallPlacement[];
    first_placements: PaywallPlacement[];
    additional_placements: PaywallPlacement[];
    // Null for flows with no linked paywall history, or an incomplete behavior report.
    funnel: OnboardingPaywallFunnel | null;
  };
  coverage: {
    legacy_views: number;
    invalid_link_views: number;
    conflicting_views: number;
    orphan_interactions: number;
    uncertain_order_attempts: number;
  };
}

export interface StoredEvent extends AnalyticsEvent {
  received_at: string;
  source: string;
  subject: string;
}
export interface TrendPoint {
  date: string;
  active_users: number;
  first_opens: number;
  events: number;
  activities: number;
  paywall_views: number;
}
/** Optional dashboard label an app sent with `setProfile` for an identified account. */
export interface PersonProfile {
  email: string | null;
  name: string | null;
}
export interface ObservedUser {
  subject: string;
  profile?: PersonProfile | null;
  /** Owner-marked tester: browsable here, left out of Production reports. */
  is_tester: boolean;
  /** Latest safely linked RevenueCat profile country, not event-time location. */
  country_code: string | null;
  events: number;
  activities: number;
  first_in_period: string;
  last_seen: string;
  platforms: string[];
  /** App version of the latest event in range. */
  app_version?: string;
  /** Latest detected build in range; `unknown` when no event in range detected one. */
  runtime_environment?: RuntimeEnvironment;
}
export interface DashboardStats {
  granularity: ReportGranularity;
  series: TrendPoint[];
  first_opens: number;
  platforms: { label: string; users: number }[];
  versions: { label: string; users: number }[];
  features: FeatureUsageReport;
  users: ObservedUser[];
  total_users: number;
  countries: AudienceCountries;
}
export interface CountryPopulation {
  status: 'observed' | 'unconnected' | 'limited';
  total: number | null;
  known: number | null;
  unknown: number | null;
  rows: { country_code: string; users: number }[];
}
export interface AudienceCountries {
  observed: CountryPopulation;
  paying: CountryPopulation;
  profiles_updated_at: string | null;
  /** Verified payments without one stable provider customer ID cannot be counted as people. */
  unidentified_payments: number;
}
export interface FeaturePoint {
  date: string;
  users: number;
  occurrences: number;
}
export interface FeatureUsage {
  name: string;
  users: number;
  occurrences: number;
  /** Sparse reporting buckets. Empty elapsed buckets have zero users/occurrences. */
  series: FeaturePoint[];
}
export interface FeatureUsageReport {
  items: FeatureUsage[];
  total_event_types: number;
  limit: number;
}
export type FeatureProperty = {
  key: string;
  present: number;
  /** Absent keys and explicit null values. Empty text/list values are present. */
  missing: number;
} & (
  | {
      kind: 'number';
      average: number;
      min: number;
      max: number;
      buckets: { from: number; to: number; occurrences: number }[];
    }
  | {
      kind: 'category';
      multi_value: boolean;
      values: { value: string | number | boolean | []; occurrences: number }[];
      total_values: number;
      value_limit: number;
    }
);
export interface FeaturePropertiesReport {
  event: string;
  occurrences: number;
  properties: FeatureProperty[];
  total_properties: number;
  limit: number;
}
export interface Journey {
  subject: string;
  profile?: PersonProfile | null;
  /** Owner-marked tester: browsable here, left out of Production reports. */
  is_tester: boolean;
  country_code: string | null;
  from: string;
  to: string;
  events: StoredEvent[];
  next_cursor: string | null;
}

export interface AcquisitionPoint {
  /** False means no acquisition coverage in this bucket. */
  acquisition_available?: boolean;
  date: string;
  new_users: number;
  direct_paid: number | null;
  trial_paid: number | null;
  trial_pending: number | null;
  trial_ended: number | null;
  /** Verified trial start with an uncertain later outcome. */
  trial_unknown: number | null;
  first_purchase_cents: number | null;
  /** Of `new_users`, those estimated from RevenueCat first-seen dates (owner opt-in). */
  estimated_new_users?: number;
}
export interface AcquisitionProduct {
  date: string;
  store: string;
  trial_product: string | null;
  paid_product: string | null;
  direct_paid: number;
  trial_paid: number;
  trial_pending: number;
  trial_ended: number;
  trial_unknown: number;
  first_purchase_cents: number | null;
}
export interface AcquisitionPerson {
  subject: string;
  /** The series interval (`AcquisitionPoint.date`) of their first use. */
  date: string;
  /** No trial or verified purchase yet (or billing unavailable) is `none`. */
  outcome:
    'direct_paid' | 'trial_paid' | 'trial_pending' | 'trial_ended' | 'trial_unknown' | 'none';
  /** First use dated by the owner-enabled RevenueCat estimate. */
  estimated?: boolean;
  profile?: PersonProfile | null;
}
export interface AcquisitionReport {
  new_user_definition: AcquisitionConfiguration;
  historical_imports?: {
    imports: number;
    first_use_records: number;
    partial_range: boolean;
    ranges: { from: string; to: string }[];
  };
  status: 'unconnected' | 'observed' | 'limited';
  /** Lifetime evidence for this app/environment; independent of the selected range. */
  tracking_status?: 'unconfigured' | 'awaiting_event' | 'awaiting_identity_link' | 'ready';
  /** Earliest matching configured event or published acquisition-coverage start, never SDK installation. */
  new_user_since: string | null;
  first_seen_users: number;
  as_of: string;
  tracking_since: string | null;
  history_complete: false;
  connection_enabled: boolean;
  last_received_at: string | null;
  series: AcquisitionPoint[];
  products: AcquisitionProduct[];
  first_purchase_cents: number | null;
  /**
   * Owner-enabled estimate: RevenueCat customers first seen in [from, to) count as Production new
   * users before live SDK evidence begins (`to`). `users` is the lifetime count used; customers
   * linked to more than one app person are left out (`ambiguous_customers`).
   */
  revenuecat_estimate?: { from: string; to: string; users: number; ambiguous_customers: number };
  /**
   * Each new user in range with their cohort interval and outcome, ordered by first use, so the
   * Overview can name the person behind a dot. Null when the range has too many people to list.
   */
  people?: AcquisitionPerson[] | null;
  coverage: {
    unmatched_receipts: number;
    conflicting_receipts: number;
    invalid_receipts: number;
    excluded_subjects: number;
    missing_first_open: number;
    missing_first_use: number;
    missing_history: number;
    unknown_amount: number;
    overdue_trials: number;
    pre_tracking_users: number;
    unsupported_receipts: number;
  };
}

export interface RevenueAmounts {
  total_cents: number | null;
  purchase_cents: number | null;
  first_payment_cents: number | null;
  renewal_cents: number | null;
  other_cents: number | null;
  refund_cents: number | null;
  reversal_cents: number | null;
  paid_transactions: number | null;
}
export interface RevenuePoint extends RevenueAmounts {
  date: string;
}
export interface SubscriptionPoint {
  date: string;
  as_of: string | null;
  products: { key: string; paid: number | null; trial: number | null }[];
}
export interface RevenueProduct {
  key: string;
  product_id: string | null;
  store: string;
  totals: RevenueAmounts;
  series: RevenuePoint[];
  active_paid: number | null;
  active_trials: number | null;
  display_name: string | null;
  duration: string | null;
  is_subscription?: boolean;
}
export interface RevenueReport {
  status: 'unconnected' | 'observed' | 'limited';
  currency: 'USD';
  as_of: string;
  tracking_since: string | null;
  last_received_at: string | null;
  connection_enabled: boolean;
  history_complete: false;
  subscription_status: 'sync_required' | 'synced' | 'stale';
  subscription_as_of: string | null;
  subscription_basis: 'period_end' | 'latest_sync' | 'live';
  subscription_history_incomplete: boolean;
  subscription_series: SubscriptionPoint[];
  recurring_metrics_status: 'unconnected' | 'sandbox_unavailable' | 'sync_required';
  sync: {
    configured: boolean;
    running: boolean;
    failed: boolean;
    completed_at: string | null;
    recovered_events: number;
  };
  totals: RevenueAmounts;
  series: RevenuePoint[];
  products: RevenueProduct[];
  coverage: {
    invalid_receipts: number;
    unsupported_receipts: number;
    conflicting_transactions: number;
    unknown_amounts: number;
    unclassified_payments: number;
    deferred_transactions: number;
    duplicate_purchases: number;
  };
}
export interface FeedbackSubmission {
  runtime_environment?: RuntimeEnvironment;
  id: string;
  message: string;
  email?: string;
  platform: 'ios' | 'android' | 'test';
  app_version: string;
  anonymous_id?: string;
  user_id?: string;
}
export interface FeedbackReceipt {
  id: string;
  received_at: string;
}
export interface FeedbackMessage extends FeedbackReceipt {
  environment: ReportingEnvironment;
  message: string;
  email: string | null;
  platform: 'ios' | 'android' | 'test';
  app_version: string;
  status: 'new' | 'handled';
  subject: string | null;
  profile?: PersonProfile | null;
}
export interface FeedbackInbox {
  items: FeedbackMessage[];
  new_count: number;
  handled_count: number;
  next_cursor: string | null;
}

/** Owner view of the RevenueCat first-seen estimate for one app (Production only). */
export interface RevenueCatEstimateStatus {
  enabled: boolean;
  coverage_from: string | null;
  connection: { id: string; name: string } | null;
  /** The connection's RevenueCat project also feeds another app, so customers cannot be assigned. */
  shared_connection: boolean;
  /** Latest completed customer scan; first-seen dates exist only in scans since migration 034. */
  scan: { completed_at: string; customers: number; with_first_seen: number } | null;
  /** First day of live SDK new-user evidence; the estimate stops before it. */
  live_since: string | null;
  /** Eligible customers by first-seen month before `live_since` (testers and Sandbox-only removed). */
  months: { month: string; customers: number }[];
  /** Start of the latest run of months without a gap of over six months: a likely RevenueCat start. */
  suggested_from: string | null;
}
