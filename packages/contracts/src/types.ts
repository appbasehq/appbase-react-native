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
/** Which report flow to read. `revision` picks a version whose steps changed without a new version. */
export interface OnboardingFlowSelection {
  id: string;
  version: string;
  revision?: number;
}
/** A question in a report: edits under the same version merge by question ID, step and type. */
export interface OnboardingReportQuestion extends OnboardingQuestion {
  /** First seen after this flow's first definition. */
  added_at?: string;
  /** Not in the newest definition; earlier answers stay counted. */
  removed?: boolean;
  options: { id: string; label: string; added_at?: string; removed?: boolean }[];
}
/**
 * One funnel: a version and its step list. A version sent with different steps without a new
 * version number appears again with `revision` (the first changed definition with those steps).
 */
export interface OnboardingReportFlow extends OnboardingDefinition {
  revision?: number;
  /** When this step list first arrived under this version. */
  first_seen_at: string;
  /** When the newest question/option edit merged into this flow first arrived. */
  edited_at?: string;
  questions?: OnboardingReportQuestion[];
}
export interface OnboardingAnswerSummary extends OnboardingReportQuestion {
  reached: number;
  answered: number;
  skipped: number;
  missing: number;
  conflicted: number;
  /** `eligible`: answered attempts whose definition offered this option (its percentage base). */
  options: (OnboardingReportQuestion['options'][number] & { count: number; eligible: number })[];
}
export interface OnboardingAnswers {
  status: 'observed' | 'limited';
  questions: OnboardingAnswerSummary[];
}
/** Wire value captured by SDKs; Unknown is reported as Production. */
export type RuntimeEnvironment = 'production' | 'sandbox' | 'development' | 'unknown';
/** Production is the App Store plus anything without a detected build; Sandbox is TestFlight/App Review. */
export type ReportingEnvironment = 'production' | 'sandbox' | 'development';
/** The signed-in owner's settings, the same in every browser they use. */
export interface AccountSettings {
  /** IANA zone whose midnights start reporting days; null (UTC) until a browser reports one. */
  time_zone: string | null;
  /** Follow the zone of the browser the owner last used, rather than a zone they chose. */
  time_zone_automatic: boolean;
}

export interface ReportingScope {
  id: string;
  environment: ReportingEnvironment;
  appId: string;
  from: string;
  to: string;
  asOf: string;
  /** IANA time zone whose midnights start the range's days (UTC unless the reader chose one). */
  timeZone: string;
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
  /** Accepted events with a setup problem worth fixing (absent from older servers). */
  warnings?: { event_id: string; message: string }[];
  /** Server steering for this key's SDKs (see behavior.md); absent means none. */
  control?: CollectionControl;
}
/** Persisted and clamped by SDKs; a valid acknowledgement without it clears the stored one. */
export interface CollectionControl {
  /** Floor for every retry delay. */
  min_retry_ms?: number;
  /** Periodic flush interval; SDKs only lengthen their configured interval with it. */
  flush_interval_ms?: number;
  /** Most events per request (1–100). */
  max_batch?: number;
  /** Send nothing before this time; events keep queueing. */
  disabled_until?: string;
  /** Discard every queued event this response did not acknowledge, counting them as dropped. */
  purge?: boolean;
}
export interface AppRecord {
  id: string;
  name: string;
  slug: string;
  collection_enabled: boolean;
  /** Chosen in the setup flow: in the App Store, or not released yet. Null for older apps. */
  release_status?: 'live' | 'unreleased' | null;
  app_store_id?: string | null;
  bundle_id?: string | null;
  /** Set when the app has an icon; also versions its URL. */
  icon_updated_at?: string | null;
  /** Null while the setup flow is unfinished; set for apps created before the flow. */
  setup_completed_at?: string | null;
}
export interface AppSetup {
  app: AppRecord;
  events: number;
  /** Whether the app has ever sent each kind of data, from any build (cards' empty states). */
  tracked?: { onboarding: boolean; paywalls: boolean; features: boolean; feedback: boolean };
  /** Lifetime events per dashboard build environment (Production includes undetected builds). */
  events_by_environment?: { production: number; sandbox: number; development: number };
  last_received_at: string | null;
  /** Accounts linked by `identify`; zero suggests a forgotten call in an app with sign-in. */
  identified_users?: number;
  /** Onboarding versions whose steps changed without a new version number (newest first). */
  changed_onboarding_versions?: { flow_id: string; version: string; changed_at: string }[];
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
  /** All of the owning account's apps together; absent for apps without an owner. */
  account?: { minute: UsageWindow; day: UsageWindow };
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
  flows: OnboardingReportFlow[];
  flow: OnboardingReportFlow | null;
  retention: { cohort: string; users: number; d1: number | null; d7: number | null }[];
  paywalls: { placement: string; version: string; exposures: number; viewers: number }[];
  paywall_journeys: PaywallJourneys;
  recent: StoredEvent[];
  dashboard: DashboardStats;
  app_health: AppHealthReport;
  acquisition: AcquisitionReport;
  /** Production only, and only when the app has an ad account connected; absent otherwise. */
  ad_spend?: AdSpendReport;
  revenue: RevenueReport;
}

/** Totals for a range or one interval. Amounts are in the ad account's currency (major units). */
export interface AdSpendTotals {
  spend: number | null;
  /** `spend` in USD at each day's ECB reference rate (the latest of the previous week on days
   * without one). Null when a day with spend has no rate. Not on campaigns. */
  spend_usd?: number | null;
  impressions: number | null;
  clicks: number | null;
  /** The ad provider's own attributed results, as it reports them; not Appbase measurements. */
  reported_installs: number | null;
  reported_trials: number | null;
}
export interface AdSpendPoint extends AdSpendTotals {
  date: string;
}
export interface AdSpendCampaign extends AdSpendTotals {
  id: string;
  name: string;
}
/**
 * What a connected ad account spent, per UTC interval, beside the app's own new users. Spend is
 * not attribution: no person is linked to an ad, and new users include people who never saw one.
 * Intervals before `covered_from` (or before the first copy finishes) are null, not zero.
 */
export interface AdSpendReport {
  provider: 'meta';
  /** `pending`: the first copy has not finished. `failing`: the last copy failed; data may be old. */
  status: 'ready' | 'pending' | 'credentials_failed' | 'failing';
  account: { id: string; name: string | null; currency: string; timezone: string };
  /** Only campaigns promoting this provider app count; null counts the whole account. */
  promoted_app: { id: string; name: string | null } | null;
  synced_at: string | null;
  covered_from: string | null;
  /** Some selected dates fall before `covered_from`. */
  partial_range: boolean;
  total: AdSpendTotals;
  series: AdSpendPoint[];
  /** Highest spend first, at most 50. */
  campaigns: AdSpendCampaign[];
  /** Spend against what new users from days with ad spend paid, before store fees; see
   * `AdReturnReport`. Absent from older responses. */
  ad_return?: AdReturnReport;
  /** The same after store commission and tax (Apple's 15% for Small Business Program members). */
  ad_return_after_fees?: AdReturnReport;
  /** The owner's saved choices (Settings / the card): which one to show, and Small Business. */
  fee_settings?: { ad_return_after_fees: boolean; apple_small_business: boolean };
}
/**
 * Ad return, counting only new users who first used the app on a day with ad spend (UTC). New
 * users on days without ads are reported in `excluded` and `paid_without_ads`, never counted.
 * Money is USD first payments, before store fees or after commission and tax (`fees`). Running
 * trials are valued at full price, as if every one pays: a ceiling, not a prediction.
 */
export interface AdReturnReport {
  basis: 'ad_days';
  /** Money before store fees (as Revenue) or after commission and tax. */
  fees: 'before' | 'after';
  points: {
    date: string;
    /** USD spend; null where spend or its exchange rate is unknown. */
    spend: number | null;
    paid: number | null;
    /** Paid by this interval's new users on days without ad spend: shown, not counted. */
    paid_without_ads: number | null;
    /** What this interval's running trials pay if every one converts, at full price. */
    trial_value: number | null;
    /** Trials still running (auto-renew on) among this interval's ad-day new users. */
    trials: number;
    /** Trials set to cancel among them: not counted in `trial_value`. */
    cancelled_trials: number;
  }[];
  total: {
    spend: number | null;
    paid: number | null;
    trial_value: number | null;
    running_trials: number;
    cancelled_trials: number;
    new_users: number | null;
    trial_starters: number | null;
    payers: number | null;
  };
  /** Days in the range with no ad spend, and what their new users paid (not counted). */
  excluded: { days: number; new_users: number | null; paid: number | null };
  /**
   * Full prices behind `trial_value`. A running trial counts at the latest price its plan was
   * paid in the trial's currency (USD, last 365 days, no trial or intro payments); without one in
   * that currency, the plan's average payment; for a plan never paid, the average across plans.
   */
  prices: {
    /** Latest full payment per plan and currency, before fees and after commission and tax. */
    by_currency: {
      product: string;
      currency: string;
      price: number;
      kept: number | null;
      paid_at: string;
    }[];
    /** Average full payment per plan, for trials in a currency it has no payment in. */
    products: { product: string; price: number; kept: number | null; payments: number }[];
    fallback_price: number | null;
    fallback_kept: number | null;
  };
  return_so_far: number | null;
  /** (paid + trial_value) ÷ spend: the return if every running trial pays. */
  return_if_trials_pay: number | null;
}

/** An app's ad account connection as Settings shows it; the token is never returned. */
export interface AdConnectionStatus {
  provider: 'meta';
  account: { id: string; name: string | null; currency: string; timezone: string };
  promoted_app: { id: string; name: string | null } | null;
  status: 'active' | 'credentials_failed';
  /** A copy is wanted or running. */
  syncing: boolean;
  synced_at: string | null;
  covered_from: string | null;
  last_error: string | null;
  connected_at: string;
  /** The owner's other apps counting the same spend: same ad account, and either one counts the
   * whole account or both count the same promoted app. */
  overlaps?: { app_id: string; app_name: string; whole_account: boolean }[];
}
/** Settings' ad spend state: this app's connection and the owner's reusable saved tokens. */
export interface AdSpendSetup {
  connections: AdConnectionStatus[];
  providers: 'meta'[];
  /** The owner's other apps with a working Meta token this app can reuse (sent as `from_app_id`),
   * with the ad account and promoted app each counts (null: the whole account). */
  reusable: {
    app_id: string;
    app_name: string;
    account_id: string;
    account_name: string | null;
    promoted_app_id: string | null;
  }[];
}
/** An ad account the token can read, with the provider apps its campaigns promote. */
export interface AdAccountChoice {
  id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  active: boolean;
  /** Spend in the last 30 days (Meta's `last_30d`, account currency); null when unreadable. */
  spend_30d: number | null;
  /** Each promoted app, with what its campaigns spent in the same 30 days. */
  apps: { id: string; name: string | null; spend_30d: number | null }[];
}

/** A selected report omits unrelated fields; omission never means measured zero. */
type ReportViewFields = {
  'new-business': Pick<Report, 'acquisition' | 'ad_spend'>;
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
    dashboard: Pick<
      DashboardStats,
      'platforms' | 'versions' | 'version_trend' | 'total_users' | 'countries'
    >;
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
/**
 * People who opened the app exactly `day` days after first use (1–30), of those whose return day
 * has finished. Later days count fewer people, since only earlier starters can have reached them.
 */
export interface RetentionPoint {
  day: number;
  eligible: number;
  returned: number | null;
}
export interface RetentionCohort {
  week: string;
  from: string;
  to: string;
  users: number;
  cells: RetentionCell[];
  /** Every day 1–30; a day stays pending until the whole week's starters have reached it. */
  curve: RetentionPoint[];
}
export interface AppHealthReport {
  new_user_definition: AcquisitionConfiguration;
  /** First matching configured event; not a promise of complete coverage. */
  new_user_since: string | null;
  /**
   * First day anyone was seen in this scope, in the app or through the app's backend (server
   * events): when activity tracking began. Can precede `new_user_since`, for example when the
   * backend reported before the app's release with Appbase. Absent in older responses.
   */
  activity_since?: string | null;
  activity_as_of: string | null;
  activity: AppHealthPoint[];
  retention: {
    users: number;
    summary: RetentionCell[];
    cohorts: RetentionCohort[];
    /** Every day 1–30, weighted across first-use days like `summary`. */
    curve: RetentionPoint[];
  };
}

export interface PaywallConversions {
  // Union of trial starters and direct purchasers, once per viewer or onboarding attempt.
  subscriptions_started: number | null;
  trials_started: number | null;
  direct_paid: number | null;
  trial_paid: number | null;
  trial_pending: number | null;
  /** Auto-renew turned off during the trial: counted as unpaid. */
  trial_cancelled: number | null;
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
  /** Design versions the owner retired; reports still count them, the card folds them away. */
  retired: { paywall_id: string; version: string; retired_at: string }[];
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
/** An event the app's backend sent for an identified account (`POST /v1/server/events`). */
export interface StoredServerEvent {
  event_id: string;
  user_id: string;
  name: string;
  occurred_at: string;
  received_at: string;
  source: 'server';
  /** The person did it (counts toward active users) rather than it happening for them. */
  active: boolean;
  /** The sender's environment, or the account's nearest detected app build (Production without one). */
  runtime_environment: 'production' | 'sandbox' | 'development';
  properties: Properties;
  subject: string;
}
/**
 * A RevenueCat event of the customer linked to this person alone (live webhook or imported
 * history), in the journey's billing environment. `name` says what it meant, by the reports' own
 * rules: `trial_started` (also a renewal into another trial period), `trial_set_to_cancel`, `auto_renew_turned_on`, `payment_failed` (the
 * store retries; access continues until `grace_ends_at`), `trial_expired`, `trial_converted`,
 * `subscribed`, `renewed`, `set_to_cancel`, `cancelled` (another reason, such as a billing error),
 * `subscription_expired`, `refunded`, `refund_reversed`, `purchased`, `subscription_extended`,
 * `product_changed`, `subscription_paused`, `transferred`, or another RevenueCat type in lowercase.
 */
export interface StoredBillingEvent {
  /** RevenueCat's event ID (lowercase), so a webhook and its imported copy are one event. */
  event_id: string;
  name: string;
  occurred_at: string;
  /** When the webhook arrived; null for an event recovered from imported history. */
  received_at: string | null;
  source: 'revenuecat';
  subject: string;
  properties: {
    /** RevenueCat's event type, such as `CANCELLATION`. */
    type: string;
    product_id: string | null;
    period_type: string | null;
    store: string | null;
    environment: string | null;
    app_user_id: string | null;
    transaction_id: string | null;
    /** The cancellation or expiration reason, such as `UNSUBSCRIBE` or `BILLING_ERROR`. */
    reason: string | null;
    /** USD, as RevenueCat reports it; negative for a refund. */
    price: number | null;
    currency: string | null;
    price_in_purchased_currency: number | null;
    expires_at: string | null;
    grace_ends_at: string | null;
    revenuecat_event_id: string;
  };
}
/** A journey interleaves app events, server events and RevenueCat billing events by time. */
export type JourneyEvent = StoredEvent | StoredServerEvent | StoredBillingEvent;
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
  /** Plan from verified billing (see `PersonPlan`); null when billing cannot tell. */
  plan?: PersonPlan | null;
  /** When the New users card counts them as new; null when it never does. */
  new_user_at?: string | null;
}
/**
 * A person's plan now, from verified billing through the RevenueCat customer linked to them
 * alone: paying, in a trial, in a trial with auto-renew turned off (set to cancel), paid before
 * but no longer (churned), a trial that ended unpaid, or free (linked, never purchased, with the
 * app's billing history imported).
 */
export type PersonPlan =
  'paid' | 'trial' | 'trial_set_to_cancel' | 'trial_canceled' | 'churned' | 'free';
/** One person's story across all their history in the selected build environment. */
export interface PersonSummary {
  first_seen: string;
  first_open: string | null;
  last_seen: string;
  /** Distinct UTC days with any app or server event. */
  active_days: number;
  /** Their latest onboarding attempt: finished, or the last step viewed. */
  onboarding: {
    flow_id: string | null;
    flow_version: string | null;
    completed: boolean;
    last_step: string | null;
  } | null;
  /** The paywalls they saw most, up to three. */
  paywalls: { paywall_id: string; views: number }[];
  /** What the app reported: a completed purchase, or a purchase started without one. */
  purchase: 'bought' | 'tapped' | null;
  plan: PersonPlan | null;
  /** Their most-used custom events, up to three. */
  features: { name: string; count: number }[];
  /** Feedback they sent, from any build. */
  feedback: { count: number; last: string | null };
  /**
   * RevenueCat app user IDs linked to them (by the app, or a historical import), most recently
   * linked first. `project_id` is the RevenueCat project when exactly one is known, else null.
   */
  revenuecat_customers: { app_user_id: string; project_id: string | null; linked_at: string }[];
}
export interface DashboardStats {
  granularity: ReportGranularity;
  series: TrendPoint[];
  first_opens: number;
  platforms: { label: string; users: number }[];
  versions: { label: string; users: number }[];
  /**
   * Intervals with app activity, each with its people and how many of them used each of the
   * range's top versions (someone who updated within an interval counts under both).
   */
  version_trend: { date: string; users: number; versions: Record<string, number> }[];
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
  /**
   * Where it was recorded: in the app, by the app's backend (server events), or both. Absent in
   * older responses (app).
   */
  source?: 'app' | 'server' | 'both';
  /** People by how many times each did it in the range; they add up to `users`. */
  frequency: FeatureFrequency;
  /** Sparse reporting buckets. Empty elapsed buckets have zero users/occurrences. */
  series: FeaturePoint[];
}
export interface FeatureFrequency {
  once: number;
  two_to_three: number;
  four_to_nine: number;
  ten_or_more: number;
}
export interface FeatureUsageReport {
  items: FeatureUsage[];
  total_event_types: number;
  limit: number;
  /** Events the owner hid from the Feature usage card; they are still counted above. */
  hidden: { name: string; hidden_at: string }[];
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
  events: JourneyEvent[];
  next_cursor: string | null;
  /** On the first page: their story across all their history; null when never seen. */
  summary?: PersonSummary | null;
}

export interface AcquisitionPoint {
  /** False means no acquisition coverage in this bucket. */
  acquisition_available?: boolean;
  date: string;
  new_users: number;
  direct_paid: number | null;
  trial_paid: number | null;
  trial_pending: number | null;
  /** Still within the trial term with auto-renew turned off; counted as unpaid. */
  trial_cancelled: number | null;
  trial_ended: number | null;
  /** Verified trial start with an uncertain later outcome. */
  trial_unknown: number | null;
  first_purchase_cents: number | null;
  /** What the developer keeps of `first_purchase_cents` after store commission and tax
   * (RevenueCat's per-payment percentages). Null when unknown; absent from older responses. */
  first_purchase_proceeds_cents?: number | null;
  /** Of `new_users`, those estimated from RevenueCat first-seen dates (owner opt-in). */
  estimated_new_users?: number;
  /** Of `new_users`, RevenueCat customers since the first live day the app has not linked yet. */
  revenuecat_only_new_users?: number;
}
export interface AcquisitionProduct {
  date: string;
  store: string;
  trial_product: string | null;
  /** The trial's store currency (from its start), which prices running trials in Ad return. */
  trial_currency?: string | null;
  paid_product: string | null;
  direct_paid: number;
  trial_paid: number;
  trial_pending: number;
  trial_cancelled: number;
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
    | 'direct_paid'
    | 'trial_paid'
    | 'trial_pending'
    | 'trial_cancelled'
    | 'trial_ended'
    | 'trial_unknown'
    | 'none';
  /** First use dated by the owner-enabled RevenueCat estimate. */
  estimated?: boolean;
  /** A RevenueCat customer the app has not linked to a person yet, dated by RevenueCat. */
  revenuecat_only?: boolean;
  profile?: PersonProfile | null;
}
/** New users in range from one country (or Unknown) and what they became. */
export interface AcquisitionCountry {
  /** ISO 3166-1 alpha-2, or null when the person has no single observed country. */
  country_code: string | null;
  new_users: number;
  /** Null without linked billing for the range, never zero. */
  direct_paid: number | null;
  trial_paid: number | null;
  trial_pending: number | null;
  trial_cancelled: number | null;
  trial_ended: number | null;
  trial_unknown: number | null;
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
  /** First payments after store commission and tax; see `AcquisitionPoint`. */
  first_purchase_proceeds_cents?: number | null;
  /**
   * Owner-enabled estimate: RevenueCat customers first seen in [from, to) count as Production new
   * users before live SDK evidence begins (`to`). `users` is the lifetime count used; customers
   * linked to more than one app person are left out (`ambiguous_customers`).
   */
  revenuecat_estimate?: { from: string; to: string; users: number; ambiguous_customers: number };
  /**
   * Production, from the first live SDK new-user day: RevenueCat customers the app has not linked
   * to a person (for example their link is still queued on the phone) count as new users on
   * RevenueCat's first-seen date, or their first purchase when they joined after the customer list
   * (`customer_list_at`). `users` is the lifetime count. Once linked they are that person instead.
   */
  revenuecat_only?: { users: number; customer_list_at: string | null };
  /**
   * Each new user in range with their cohort interval and outcome, ordered by first use, so the
   * Overview can name the person behind a dot. Null when the range has too many people to list.
   */
  people?: AcquisitionPerson[] | null;
  /**
   * Owner dashboards: the range's new users by country (latest observed RevenueCat country of
   * their linked customer; Unknown without one), most new users first.
   */
  countries?: AcquisitionCountry[];
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
  /** `trial_cancelled`: of `trial`, those set to cancel (auto-renew turned off). */
  products: {
    key: string;
    paid: number | null;
    trial: number | null;
    trial_cancelled: number | null;
  }[];
}
export interface RevenueProduct {
  key: string;
  product_id: string | null;
  store: string;
  totals: RevenueAmounts;
  series: RevenuePoint[];
  active_paid: number | null;
  active_trials: number | null;
  /** Of `active_trials`, those set to cancel (auto-renew turned off). */
  active_trials_cancelled: number | null;
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
