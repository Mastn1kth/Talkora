import { randomUUID } from 'node:crypto';

const SESSION_DAYS = 30;

function normalize(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en-GB')
    .replace(/[‘’`]/g, "'").replace(/ё/g, 'е')
    .replace(/[.!?…]+$/g, '').trim().replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/g, '').trim();
}

function choices(answer, alternatives) {
  return [answer, ...alternatives.filter(value => value !== answer)].slice(0, 4);
}

function exercisePool(sessionId, words) {
  return words.flatMap((word, index) => {
    const others = words.filter((_, otherIndex) => otherIndex !== index);
    const prefix = `practice-${sessionId}-${index}`;
    const explanation = `В вашем списке: ${word.english} — ${word.russian}.`;
    return [
      { id: `${prefix}-meaning`, type: 'choice', prompt: `Выберите перевод: ${word.english}`, answer: word.russian, options: choices(word.russian, others.map(item => item.russian)), hint: `Первая буква перевода: ${word.russian[0]}.`, explanation, word: word.english },
      { id: `${prefix}-write`, type: 'input', prompt: `Напишите слово или фразу из вашего списка: «${word.russian}»`, answer: word.english, hint: `Начинается с «${word.english[0]}».`, explanation, word: word.english },
      { id: `${prefix}-listen`, type: 'listen', prompt: 'Послушайте и напишите слово или фразу.', answer: word.english, audio: word.english, hint: `Перевод из вашего списка: ${word.russian}`, explanation, word: word.english },
      word.english.split(/\s+/).length > 1
        ? { id: `${prefix}-build`, type: 'build', prompt: `Соберите фразу из вашего списка: «${word.russian}»`, answer: word.english, options: word.english.split(/\s+/).reverse(), hint: `Начните с «${word.english.split(' ')[0]}».`, explanation, word: word.english }
        : { id: `${prefix}-reverse`, type: 'choice', prompt: `Выберите английское слово из вашего списка: «${word.russian}»`, answer: word.english, options: choices(word.english, others.map(item => item.english)), hint: `Первая буква: ${word.english[0]}.`, explanation, word: word.english },
    ];
  });
}

function selectMixed(exercises, minutes) {
  const limit = minutes <= 5 ? 6 : minutes <= 10 ? 10 : 14;
  const groups = new Map();
  for (const exercise of exercises) {
    const group = groups.get(exercise.type) ?? [];
    group.push(exercise);
    groups.set(exercise.type, group);
  }
  const result = [];
  while (result.length < Math.min(limit, exercises.length)) {
    for (const group of groups.values()) {
      const exercise = group.shift();
      if (exercise) result.push(exercise);
      if (result.length === limit) break;
    }
  }
  return result;
}

export function createPractice(database, now = () => new Date()) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS practice_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      title TEXT NOT NULL,
      exercises TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS practice_sessions_user ON practice_sessions(user_id, created_at);
  `);

  function createWords(userId, words, minutes) {
    const id = randomUUID();
    const activityId = `words-${id}`;
    const title = 'Твои слова в деле';
    const exercises = selectMixed(exercisePool(id, words), minutes);
    const created = now();
    database.prepare(`INSERT INTO practice_sessions(id, user_id, kind, activity_id, title, exercises, created_at, expires_at)
      VALUES (?, ?, 'words', ?, ?, ?, ?, ?)`).run(id, userId, activityId, title, JSON.stringify(exercises), created.toISOString(), created.getTime() + SESSION_DAYS * 86_400_000);
    database.prepare('DELETE FROM practice_sessions WHERE expires_at < ?').run(created.getTime());
    database.prepare(`DELETE FROM practice_sessions WHERE user_id = ? AND id NOT IN
      (SELECT id FROM practice_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100)`).run(userId, userId);
    return { sessionId: id, activityId, title, exercises };
  }

  function verifyEvent(userId, previousState, event) {
    const proof = event.proof;
    if (!proof || typeof proof !== 'object' || typeof proof.sessionId !== 'string') return { handled: false };
    const row = database.prepare('SELECT * FROM practice_sessions WHERE id = ? AND user_id = ?').get(proof.sessionId, userId);
    if (!row || row.expires_at < now().getTime()) return { handled: true, verified: false, error: 'Сессия тренировки не найдена или устарела.' };
    let exercises;
    try { exercises = JSON.parse(row.exercises); } catch { return { handled: true, verified: false, error: 'Сессия тренировки повреждена.' }; }
    if (proof.activityId !== row.activity_id || !Array.isArray(proof.responses) || proof.responses.length !== exercises.length) {
      return { handled: true, verified: false, error: 'Ответы не совпадают с выданной тренировкой.' };
    }
    let correct = 0;
    for (let index = 0; index < exercises.length; index++) {
      const response = proof.responses[index];
      const exercise = exercises[index];
      if (!response || response.exerciseId !== exercise.id || typeof response.answer !== 'string' || response.answer.length > 500) {
        return { handled: true, verified: false, error: 'Ответы не совпадают с выданной тренировкой.' };
      }
      if (normalize(response.answer) && normalize(response.answer) === normalize(exercise.answer)) correct++;
    }
    const accuracy = Math.round(correct / exercises.length * 100);
    const expectedXp = previousState.progress.completedLessons.includes(row.activity_id) ? 10 : 30;
    if (event.title !== row.title || event.accuracy !== accuracy || event.xp !== expectedXp || event.coins !== 5) {
      return { handled: true, verified: false, error: 'Результат или награда тренировки не совпадает с проверенными ответами.' };
    }
    return { handled: true, verified: true, activityId: row.activity_id, practiceKind: row.kind };
  }

  return { createWords, verifyEvent };
}
