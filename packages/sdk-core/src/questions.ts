import { validQuestions } from './validation.js';
import type { OnboardingQuestion } from '@mobile-analytics/contracts/types';

export type QuestionInput = Omit<OnboardingQuestion, 'options'> & {
  options: readonly OnboardingQuestion['options'][number][];
};
export function questions(
  input: readonly QuestionInput[],
  steps: readonly string[],
): OnboardingQuestion[] {
  if (!Array.isArray(steps) || !validQuestions(input, steps))
    throw new Error('Use declared steps and at most 20 unique questions with valid titles/options');
  return input.map((q) => ({
    id: q.id,
    stepId: q.stepId,
    title: q.title,
    type: q.type,
    options: q.options.map((o) => ({ id: o.id, label: o.label })),
  }));
}
