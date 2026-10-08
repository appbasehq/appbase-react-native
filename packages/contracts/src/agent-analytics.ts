import { z } from 'zod';
import { reportGranularities } from './reporting.js';
import type { ReportViewResult } from './types.js';

/** Aggregate reports only. User journeys and free-form feedback require separate access. */
export const agentReportNames = [
  'new-business',
  'revenue',
  'subscriptions',
  'onboarding',
  'paywalls',
  'app-health',
  'features',
  'audience',
] as const;
export type AgentReportName = (typeof agentReportNames)[number];
export type AgentReportData = ReportViewResult<AgentReportName>;
export const analyticsAccessSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    app_ids: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, 'App IDs must be unique'),
    expires_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export const analyticsListSchema = z.object({ after: z.uuid().optional() }).strict();
const label = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
export const agentReportQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    granularity: z.enum(reportGranularities).default('daily'),
    compare: z.literal('previous_period').optional(),
    flow_id: label.optional(),
    flow_version: label.optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    const from = Date.parse(q.from),
      to = Date.parse(q.to);
    if (from < 0 || to <= from || to - from > 366 * 5 * 86400000)
      ctx.addIssue({
        code: 'custom',
        message: 'Use a positive UTC range of at most 1,830 days, starting in 1970 or later',
      });
    if (q.compare && from - (to - from) < 0)
      ctx.addIssue({ code: 'custom', message: 'The comparison must start in 1970 or later' });
    if (Boolean(q.flow_id) !== Boolean(q.flow_version))
      ctx.addIssue({ code: 'custom', message: 'Supply both flow_id and flow_version' });
  });
export interface AnalyticsMetric {
  value: number | null;
  unit: 'count' | 'usd_cents' | 'ratio';
  basis: 'period' | 'snapshot' | 'cohort';
  definition: string;
  as_of?: string | null;
  period_aligned?: boolean;
  numerator?: number | null;
  denominator?: number | null;
  maturity?: 'so_far' | 'settled' | 'unknown';
}
export type AnalyticsMetrics = Record<string, AnalyticsMetric>;
export interface AnalyticsWarning {
  code: string;
  message: string;
}
