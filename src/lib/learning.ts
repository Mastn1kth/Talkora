import type { Exercise } from './content';

/** Ignore presentation differences, but retain meaningful spelling and word order. */
export function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-GB')
    .replace(/[‘’`]/g, "'").replace(/ё/g, 'е')
    .replace(/[.!?…]+$/g, '').trim().replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/g, '').trim();
}

export function isCorrect(answer: string, expected: string): boolean {
  const actual = normalizeAnswer(answer);
  return actual.length > 0 && actual === normalizeAnswer(expected);
}

/** Round-robin across exercise types preserves a mix, even in short lessons. */
export function exercisesForDuration(exercises: Exercise[], minutes: number): Exercise[] {
  const limit = minutes <= 5 ? 6 : minutes <= 10 ? 10 : 14;
  const groups = new Map<Exercise['type'], Exercise[]>();
  for (const exercise of exercises) {
    const group = groups.get(exercise.type) ?? [];
    group.push(exercise);
    groups.set(exercise.type, group);
  }
  const result: Exercise[] = [];
  while (result.length < Math.min(limit, exercises.length)) {
    for (const group of groups.values()) {
      const exercise = group.shift();
      if (exercise) result.push(exercise);
      if (result.length === limit) break;
    }
  }
  return result;
}

/** The short seed test opens a course arena; it is not a CEFR certification. */
export function placementArenaForScore(correct: number, total: number): number {
  const ratio = total > 0 ? correct / total : 0;
  return ratio >= 0.85 ? 3 : ratio >= 0.65 ? 2 : ratio >= 0.4 ? 1 : 0;
}

export interface ReviewState {
  correctStreak: number;
  lapses: number;
  intervalDays: number;
  dueAt: string;
}

/** A transparent initial SRS. An error returns even a known word to today's queue. */
export function scheduleReview(previous: ReviewState | undefined, correct: boolean, now = new Date()): ReviewState {
  const correctStreak = correct ? (previous?.correctStreak ?? 0) + 1 : 0;
  const intervals = [1, 3, 7, 14, 30, 60];
  const intervalDays = correct ? intervals[Math.min(correctStreak - 1, intervals.length - 1)] : 0;
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + intervalDays);
  return { correctStreak, lapses: (previous?.lapses ?? 0) + (correct ? 0 : 1), intervalDays, dueAt: due.toISOString() };
}

export function markWordKnown(now = new Date()): ReviewState {
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + 14);
  return { correctStreak: 4, lapses: 0, intervalDays: 14, dueAt: due.toISOString() };
}

export function isReviewDue(state: ReviewState | undefined, now = new Date()): boolean {
  return !state || Date.parse(state.dueAt) <= now.getTime();
}
