export const STREAK_RESTORE_COST = 20;

export type StreakProgress = {
  streak: number;
  lastStudyDate: string | null;
  streakRestoredDate?: string | null;
  freeRestoreUsed: boolean;
  coins: number;
};

export function calendarGap(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

export function streakStatus(progress: StreakProgress, day: string): 'none' | 'active' | 'recoverable' | 'restored' | 'expired' {
  if (!progress.lastStudyDate || progress.streak < 1) return 'none';
  const gap = calendarGap(progress.lastStudyDate, day);
  if (gap >= 0 && gap <= 1) return 'active';
  if (gap === 2) return progress.streakRestoredDate === day ? 'restored' : 'recoverable';
  return 'expired';
}

export function visibleStreak(progress: StreakProgress, day: string): number {
  return streakStatus(progress, day) === 'expired' ? 0 : progress.streak;
}

export function streakAfterLesson(progress: StreakProgress, day: string): number {
  if (!progress.lastStudyDate) return 1;
  const gap = calendarGap(progress.lastStudyDate, day);
  if (gap === 0) return Math.max(1, progress.streak);
  if (gap === 1 || (gap === 2 && progress.streakRestoredDate === day)) return progress.streak + 1;
  return 1;
}

export function restorePrice(progress: StreakProgress, day: string): number | null {
  return streakStatus(progress, day) === 'recoverable' ? progress.freeRestoreUsed ? STREAK_RESTORE_COST : 0 : null;
}
