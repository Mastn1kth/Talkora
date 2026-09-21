/**
 * Integrity checks for the offline study journal. These checks prevent accidental
 * corruption and simple counter edits. They do not prove that a client solved an
 * exercise; competitive points must eventually be awarded by the server.
 */
export function studyLedgerError(previous, next, { allowRestore = false, verifyEvent, isPublishedActivity } = {}) {
  const oldEvents = new Map();
  for (const event of previous.history) {
    if (typeof event.id !== 'string' || oldEvents.has(event.id)) return 'Сохранённая история занятий повреждена.';
    oldEvents.set(event.id, event);
  }
  const seen = new Set();
  let addedXp = 0;
  let addedCoins = 0;
  const restores = [];
  const studies = [];
  const verifiedActivities = new Set();
  const verifiedGateArenas = new Set();
  const completedForVerification = new Set(previous.progress.completedLessons);
  for (const event of next.history) {
    if (!event || typeof event.id !== 'string' || event.id.length < 1 || event.id.length > 100 || seen.has(event.id)) return 'В истории занятий есть повторяющиеся или неверные события.';
    seen.add(event.id);
    const old = oldEvents.get(event.id);
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(event)) return 'Уже сохранённое занятие нельзя изменить.';
      continue;
    }
    if (typeof event.date !== 'string' || !Number.isFinite(Date.parse(event.date)) || new Date(event.date).toISOString() !== event.date ||
        typeof event.title !== 'string' || event.title.trim().length < 1 || event.title.length > 150 ||
        !Number.isSafeInteger(event.xp) || event.xp < 0 || event.xp > 50 ||
        !Number.isSafeInteger(event.coins) || event.coins < -20 || event.coins > 10 ||
        (event.accuracy !== undefined && (!Number.isSafeInteger(event.accuracy) || event.accuracy < 0 || event.accuracy > 100))) {
      return 'Некорректное начисление за занятие.';
    }
    if (event.kind === 'streak_restore') {
      if (event.xp !== 0 || ![0, -20].includes(event.coins) || typeof event.restoreDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.restoreDate)) return 'Некорректное восстановление серии.';
      restores.push(event);
    } else if (event.coins < 0 || event.kind !== undefined) return 'Некорректный расход кристаллов.';
    if (event.xp > 0) {
      const studyDay = event.studyDate ?? event.date.slice(0, 10);
      const dateDay = event.date.slice(0, 10);
      const difference = Date.parse(`${studyDay}T00:00:00.000Z`) - Date.parse(`${dateDay}T00:00:00.000Z`);
      if (typeof studyDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(studyDay) || !Number.isFinite(difference) || Math.abs(difference) > 86_400_000) return 'Некорректная дата занятия.';
      studies.push({ date: event.date, day: studyDay });
    }
    if (event.id.startsWith('bonus-') && (event.xp !== 0 || event.coins !== 10 || !/^bonus-\d{4}-\d{2}-\d{2}$/.test(event.id))) return 'Некорректный ежедневный бонус.';
    if (event.proof !== undefined) {
      const verification = verifyEvent?.({ ...previous, progress: { ...previous.progress, completedLessons: [...completedForVerification] } }, event);
      if (!verification || verification.error || !verification.verified) return verification?.error || 'Не удалось проверить результат урока.';
      verifiedActivities.add(verification.activityId);
      completedForVerification.add(verification.activityId);
      if (verification.passedGate) verifiedGateArenas.add(verification.arenaId);
    }
    addedXp += event.xp;
    addedCoins += event.coins;
  }
  for (const id of oldEvents.keys()) if (!seen.has(id)) return 'Историю занятий нельзя удалить.';
  const oldCompleted = new Set(previous.progress.completedLessons);
  const nextCompleted = new Set(next.progress.completedLessons);
  if (nextCompleted.size !== next.progress.completedLessons.length) return 'Список завершённых занятий содержит повторы.';
  for (const id of oldCompleted) if (!nextCompleted.has(id)) return 'Завершённые занятия нельзя удалить.';
  for (const id of nextCompleted) if (!oldCompleted.has(id) && isPublishedActivity?.(id) && !verifiedActivities.has(id)) return 'Основной урок можно завершить только после проверки ответов.';
  const oldArenas = new Set(previous.progress.passedArenas);
  const nextArenas = new Set(next.progress.passedArenas);
  if (nextArenas.size !== next.progress.passedArenas.length) return 'Список пройденных арен содержит повторы.';
  for (const id of oldArenas) if (!nextArenas.has(id)) return 'Пройденные арены нельзя удалить.';
  for (const id of nextArenas) if (!oldArenas.has(id) && !verifiedGateArenas.has(id)) return 'Арену открывает только успешно проверенный мини-тест.';
  if (previous.progress.freeRestoreUsed && !next.progress.freeRestoreUsed) return 'Бесплатное восстановление серии уже использовано.';
  if (!previous.progress.freeRestoreUsed && next.progress.freeRestoreUsed && !restores.length) return 'Бесплатное восстановление требует отдельного события.';
  if (restores.length && !allowRestore) return 'Восстановление серии выполняется только отдельным серверным запросом.';
  if (restores.length > 1) return 'Сначала синхронизируйте предыдущее восстановление серии.';
  if (restores.length) {
    const restore = restores[0];
    const start = Date.parse(`${previous.progress.lastStudyDate}T00:00:00.000Z`);
    const end = Date.parse(`${restore.restoreDate}T00:00:00.000Z`);
    if (previous.progress.streak < 1 || !Number.isFinite(start) || end - start !== 2 * 86_400_000 ||
        previous.progress.streakRestoredDate === restore.restoreDate ||
        next.progress.streakRestoredDate !== restore.restoreDate || !next.progress.freeRestoreUsed ||
        restore.coins !== (previous.progress.freeRestoreUsed ? -20 : 0)) return 'Сейчас серию нельзя восстановить или стоимость неверна.';
  } else if ((next.progress.streakRestoredDate ?? null) !== (previous.progress.streakRestoredDate ?? null)) return 'Дата восстановления серии изменена без события.';
  let expectedStreak = previous.progress.streak;
  let expectedLastDay = previous.progress.lastStudyDate;
  let expectedBest = previous.progress.bestStreak ?? previous.progress.streak;
  for (const study of studies.sort((a, b) => a.date.localeCompare(b.date))) {
    if (expectedLastDay && study.day < expectedLastDay) continue;
    const gap = expectedLastDay ? Date.parse(`${study.day}T00:00:00.000Z`) - Date.parse(`${expectedLastDay}T00:00:00.000Z`) : null;
    expectedStreak = gap === 0 ? Math.max(1, expectedStreak)
      : gap === 86_400_000 || (gap === 2 * 86_400_000 && next.progress.streakRestoredDate === study.day) ? expectedStreak + 1 : 1;
    expectedLastDay = study.day;
    expectedBest = Math.max(expectedBest, expectedStreak);
  }
  if (next.progress.streak !== expectedStreak || next.progress.lastStudyDate !== expectedLastDay ||
      (next.progress.bestStreak !== undefined && next.progress.bestStreak !== expectedBest)) return 'Серия занятий не совпадает с историей обучения.';
  if (next.progress.xp !== previous.progress.xp + addedXp) return 'Очки успеха не совпадают с историей занятий.';
  if (next.progress.coins !== previous.progress.coins + addedCoins) return 'Баланс кристаллов не совпадает с историей занятий.';
  return null;
}
