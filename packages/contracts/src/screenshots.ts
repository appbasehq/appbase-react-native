import { z } from 'zod';
import { trackingLabel } from './index.js';

// Server/dashboard attachments, deliberately separate from the mobile wire contract.
export const SCREENSHOT_LIMITS = {
  inputBytes: 10 * 1024 * 1024,
  pixels: 20_000_000,
  dimension: 8192,
  imageBytes: 256 * 1024,
  thumbnailBytes: 64 * 1024,
  environmentBytes: 50 * 1024 * 1024,
  tokenMinute: 60,
  ownerMinute: 120,
  leaseSeconds: 120,
} as const;
export const screenshotTargetSchema = z
  .object({
    id: z.uuid(),
    flow: trackingLabel,
    version: trackingLabel,
    step: trackingLabel,
  })
  .strict();
export const screenshotMetadataSchema = z
  .object({
    platform: z.enum(['ios', 'android', 'other']).optional(),
    locale: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,35}$/)
      .optional(),
    build: z.string().trim().min(1).max(80).optional(),
    captured_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type ScreenshotMetadata = z.infer<typeof screenshotMetadataSchema>;
export interface StepScreenshot extends ScreenshotMetadata {
  id: string;
  flow_id: string;
  flow_version: string;
  step_id: string;
  uploaded_at: string;
  width: number;
  height: number;
  bytes: number;
  thumbnail_bytes: number;
}
export interface ScreenshotListing {
  app: { id: string; name: string; environment: 'development' | 'production' };
  flows: { id: string; version: string; steps: string[] }[];
  screenshots: StepScreenshot[];
  available: boolean;
}
export interface ScreenshotAccessState {
  access: { id: string; created_at: string; last_used_at: string | null } | null;
  token?: string;
}
