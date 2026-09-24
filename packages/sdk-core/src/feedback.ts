import { validUuid } from './validation.js';
import { retryDelay } from './delivery.js';
import { MOBILE_LIMITS } from '@mobile-analytics/contracts/mobile-constants';
import type { FeedbackReceipt, FeedbackSubmission } from '@mobile-analytics/contracts/types';

export interface FeedbackInput {
  message: string;
  email?: string;
  /** Keep this ID when retrying a failed/uncertain submission. FeedbackSheet handles it. */
  submissionId?: string;
}
export class FeedbackError extends Error {
  readonly name = 'FeedbackError';
  constructor(
    message: string,
    readonly submissionId: string,
    readonly code:
      'invalid_input' | 'network' | 'rate_limited' | 'configuration' | 'conflict' | 'unavailable',
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
export async function submitFeedback(
  input: FeedbackInput,
  context: Omit<FeedbackSubmission, 'id' | 'message' | 'email'>,
  options: {
    generateId: () => string;
    fetch: typeof fetch;
    apiUrl: string;
    collectionKey: string;
    timeout: number;
  },
): Promise<FeedbackReceipt> {
  const id = input?.submissionId ?? options.generateId();
  const message = typeof input?.message === 'string' ? input.message.trim() : '';
  const email = typeof input?.email === 'string' ? input.email.trim() : '';
  if (
    !validUuid(id) ||
    !message ||
    message.length > MOBILE_LIMITS.feedbackMessageLength ||
    message.includes('\0') ||
    (input?.email !== undefined && typeof input.email !== 'string') ||
    (email &&
      (email.length > MOBILE_LIMITS.feedbackEmailLength ||
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))
  ) {
    throw new FeedbackError(
      'Enter a message of 1–4000 characters and a valid optional email.',
      id,
      'invalid_input',
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout);
  try {
    const response = await options.fetch(`${options.apiUrl.replace(/\/$/, '')}/v1/feedback`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-api-key': options.collectionKey },
      body: JSON.stringify({ ...context, id, message, ...(email ? { email } : {}) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const wait = retryDelay(response.headers.get('Retry-After'), Date.now()) / 1000;
      const [code, text] =
        response.status === 429
          ? (['rate_limited', 'Too many messages. Please try again later.'] as const)
          : response.status === 409
            ? (['conflict', 'This submission ID was already used for another message.'] as const)
            : response.status === 400
              ? (['invalid_input', 'Check your message and email, then try again.'] as const)
              : response.status === 401 || response.status === 403
                ? (['configuration', 'Contact is unavailable. Please try again later.'] as const)
                : (['unavailable', 'Could not confirm delivery. Please try again.'] as const);
      throw new FeedbackError(text, id, code, Number.isFinite(wait) && wait > 0 ? wait : undefined);
    }
    const receipt = (await response.json()) as FeedbackReceipt;
    if (
      receipt?.id !== id ||
      typeof receipt.received_at !== 'string' ||
      !Number.isFinite(Date.parse(receipt.received_at))
    )
      throw new FeedbackError('Could not confirm delivery. Please try again.', id, 'unavailable');
    return receipt;
  } catch (error) {
    if (error instanceof FeedbackError) throw error;
    throw new FeedbackError(
      'Could not confirm delivery. Check your connection and try again.',
      id,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
}
