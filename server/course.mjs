import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('./course.generated.json', import.meta.url), 'utf8'));
if (catalog.version !== 1 || !catalog.activities || typeof catalog.activities !== 'object') throw new Error('Invalid generated course catalog. Run npm run content:export.');

function normalize(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en-GB')
    .replace(/[‘’`]/g, "'").replace(/ё/g, 'е')
    .replace(/[.!?…]+$/g, '').trim().replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/g, '').trim();
}

export function verifyCourseEvent(previousState, event) {
  if (event.proof === undefined) return { verified: false };
  const proof = event.proof;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) ||
      typeof proof.contentId !== 'string' || typeof proof.activityId !== 'string' || !Array.isArray(proof.responses) ||
      proof.responses.length < 1 || proof.responses.length > 20) return { verified: false, error: 'Некорректное подтверждение урока.' };
  const activity = catalog.activities[proof.contentId];
  if (!activity) return { verified: false, error: 'Этот урок отсутствует в опубликованном курсе.' };
  const ids = [];
  const seen = new Set();
  let correct = 0;
  for (const response of proof.responses) {
    if (!response || typeof response !== 'object' || Array.isArray(response) || typeof response.exerciseId !== 'string' ||
        typeof response.answer !== 'string' || response.answer.length > 500 || seen.has(response.exerciseId) || !(response.exerciseId in activity.answers)) {
      return { verified: false, error: 'Ответы урока повреждены или содержат неизвестное задание.' };
    }
    seen.add(response.exerciseId);
    ids.push(response.exerciseId);
    if (normalize(response.answer) && normalize(response.answer) === normalize(activity.answers[response.exerciseId])) correct++;
  }
  const allowed = activity.allowedExerciseSets.some(set => set.length === ids.length && set.every((id, index) => id === ids[index]));
  if (!allowed) return { verified: false, error: 'Набор заданий не совпадает с опубликованным уроком.' };
  const accuracy = Math.round(correct / ids.length * 100);
  const passed = activity.mode !== 'gate' || correct / ids.length >= 0.75;
  const activityId = activity.mode === 'gate' && !passed ? `${proof.contentId}-practice` : proof.contentId;
  const baseXp = activity.mode === 'gate' ? (passed ? 50 : 10) : 30;
  const expectedXp = previousState.progress.completedLessons.includes(activityId) ? Math.min(baseXp, 10) : baseXp;
  if (proof.activityId !== activityId || event.title !== activity.title || event.accuracy !== accuracy || event.xp !== expectedXp || event.coins !== 5) {
    return { verified: false, error: 'Результат или награда урока не совпадает с проверенными ответами.' };
  }
  return { verified: true, activityId, arenaId: activity.arenaId, passedGate: activity.mode === 'gate' && passed };
}

export function isPublishedActivity(id) {
  return Boolean(catalog.activities[id] || Object.keys(catalog.activities).some(contentId => `${contentId}-practice` === id));
}

export function curatedTopicMaterial(topicId, profile, minutes) {
  const topic = catalog.topics?.[topicId];
  if (!topic || ![5, 10, 15].includes(minutes)) return null;
  const audience = /^(0.?14|child|kids|children|under.?15)$/i.test(String(profile.age).trim()) ? 'child' : 'general';
  const difficulty = /^(A0|A1|beginner|начинающий)$/i.test(String(profile.level)) ? 'beginner' : 'extended';
  const variant = topic[`${audience}-${difficulty}`];
  if (!variant) return null;
  const durationIndex = minutes === 5 ? 0 : minutes === 10 ? 1 : 2;
  const ids = variant.allowedExerciseSets[durationIndex];
  return { title: variant.title, description: variant.description, words: variant.words,
    exercises: ids.map(id => structuredClone(variant.exercises[id])) };
}
