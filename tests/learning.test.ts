import assert from 'node:assert/strict';
import test from 'node:test';
import { arenas, createWordTraining, dictionary, getTopicTraining, grammarArticles } from '../src/lib/content.ts';
import { exercisesForDuration, isCorrect, isReviewDue, markWordKnown, normalizeAnswer, placementArenaForScore, scheduleReview } from '../src/lib/learning.ts';
import { parseWordText, WordImportError } from '../src/lib/import.ts';
import { restorePrice, streakAfterLesson, streakStatus, visibleStreak } from '../src/lib/streak.ts';

test('one missed day can be restored once for free, then for currency; two missed days end the streak', () => {
  const progress = { streak: 6, lastStudyDate: '2026-09-18', streakRestoredDate: null, freeRestoreUsed: false, coins: 15 };
  assert.equal(streakStatus(progress, '2026-09-20'), 'recoverable');
  assert.equal(restorePrice(progress, '2026-09-20'), 0);
  assert.equal(visibleStreak(progress, '2026-09-20'), 6);
  assert.equal(streakAfterLesson(progress, '2026-09-20'), 1);
  const restored = { ...progress, streakRestoredDate: '2026-09-20', freeRestoreUsed: true };
  assert.equal(streakStatus(restored, '2026-09-20'), 'restored');
  assert.equal(streakAfterLesson(restored, '2026-09-20'), 7);
  assert.equal(restorePrice({ ...restored, streakRestoredDate: null }, '2026-09-20'), 20);
  assert.equal(streakStatus(progress, '2026-09-21'), 'expired');
  assert.equal(visibleStreak(progress, '2026-09-21'), 0);
  assert.equal(streakAfterLesson(progress, '2026-09-21'), 1);
});

test('answers tolerate typography, case and final punctuation without tolerating wrong grammar', () => {
  assert.equal(normalizeAnswer('  I   don’t know.  '), "i don't know");
  assert.ok(isCorrect('THE TRAIN IS LATE!', 'The train is late.'));
  assert.ok(isCorrect('все', 'всё'));
  assert.ok(!isCorrect('I did not went.', 'I did not go.'));
  assert.ok(!isCorrect('I am a boy', 'I am boy'));
  assert.ok(!isCorrect('', ''));
  assert.ok(!isCorrect('I am', 'I’m'));
});

test('lesson duration selects a mixed, bounded set and leaves the original intact', () => {
  const source = arenas[0].lessons[0].exercises;
  const original = JSON.stringify(source);
  for (const [minutes, count] of [[5, 6], [10, 10], [15, 12]]) {
    const result = exercisesForDuration(source, minutes);
    assert.equal(result.length, count);
    assert.equal(new Set(result.map(item => item.type)).size, 4);
    assert.equal(new Set(result.map(item => item.id)).size, result.length);
  }
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(exercisesForDuration([], 5), []);
});

test('placement score maps monotonically from the first arena to the A2 arena', () => {
  assert.equal(placementArenaForScore(0, 8), 0);
  assert.equal(placementArenaForScore(4, 8), 1);
  assert.equal(placementArenaForScore(6, 8), 2);
  assert.equal(placementArenaForScore(7, 8), 3);
  assert.equal(placementArenaForScore(8, 8), 3);
});

test('an error returns a manually known word to immediate repetition', () => {
  const now = new Date('2026-09-20T10:00:00.000Z');
  const known = markWordKnown(now);
  assert.equal(known.dueAt, '2026-10-04T10:00:00.000Z');
  assert.ok(!isReviewDue(known, now));
  const failed = scheduleReview(known, false, now);
  assert.equal(failed.correctStreak, 0);
  assert.equal(failed.lapses, 1);
  assert.ok(isReviewDue(failed, now));
  const first = scheduleReview(failed, true, now);
  assert.equal(first.intervalDays, 1);
  assert.equal(first.lapses, 1);
  const second = scheduleReview(first, true, now);
  assert.equal(second.intervalDays, 3);
});

test('imports common text delimiters, CRLF, BOM and headers', () => {
  assert.deepEqual(parseWordText('\uFEFFEnglish;Russian\r\napple;яблоко\r\nbook\tкнига\ntrain — поезд\nwater - вода'), [
    { english: 'apple', russian: 'яблоко' }, { english: 'book', russian: 'книга' },
    { english: 'train', russian: 'поезд' }, { english: 'water', russian: 'вода' },
  ]);
  assert.deepEqual(parseWordText('mother-in-law — тёща, свекровь'), [{ english: 'mother-in-law', russian: 'тёща, свекровь' }]);
});

test('CSV imports quoted commas, semicolons, escaped quotes and multiline fields', () => {
  assert.deepEqual(parseWordText('"hello, friend","привет, друг"\n"say ""hello""","скажи «привет»"\n"boarding\npass","посадочный талон"'), [
    { english: 'hello, friend', russian: 'привет, друг' },
    { english: 'say "hello"', russian: 'скажи «привет»' },
    { english: 'boarding pass', russian: 'посадочный талон' },
  ]);
  assert.deepEqual(parseWordText('"one; two";"один; два"'), [{ english: 'one; two', russian: 'один; два' }]);
});

test('imports reject missing translations, malformed CSV and extra columns', () => {
  assert.throws(() => parseWordText('apple'), WordImportError);
  assert.throws(() => parseWordText('apple;'), /не хватает слова или перевода/);
  assert.throws(() => parseWordText(';яблоко'), /не хватает слова или перевода/);
  assert.throws(() => parseWordText('"apple,яблоко'), /не закрыты кавычки/);
  assert.throws(() => parseWordText('"apple"wrong,яблоко'), /лишний текст/);
  assert.throws(() => parseWordText('apple,яблоко,extra'), /два столбца/);
  assert.throws(() => parseWordText('English,Russian'), /список пуст/);
});

test('review import accepts untranslated words without replacing user translations', () => {
  assert.deepEqual(parseWordText('English\nairport\nhello;привет', { allowMissingTranslation: true }), [
    { english: 'airport', russian: '' }, { english: 'hello', russian: 'привет' },
  ]);
  assert.deepEqual(parseWordText('airport,', { allowMissingTranslation: true }), [{ english: 'airport', russian: '' }]);
  assert.throws(() => parseWordText(';аэропорт', { allowMissingTranslation: true }), /не хватает слова/);
});

test('imports deduplicate exact pairs, preserve alternate user translations and enforce limits', () => {
  assert.deepEqual(parseWordText('book;книга\nBOOK;книга\nbook;бронировать'), [
    { english: 'book', russian: 'книга' }, { english: 'book', russian: 'бронировать' },
  ]);
  assert.equal(parseWordText(Array.from({ length: 500 }, (_, i) => `word${i};слово${i}`).join('\n')).length, 500);
  assert.throws(() => parseWordText(Array.from({ length: 501 }, (_, i) => `word${i};слово${i}`).join('\n')), /500 записей/);
  assert.throws(() => parseWordText('a'.repeat(1_000_001)), /слишком большой текст/);
});

test('curriculum references exist; options contain one answer; sentence building is solvable', () => {
  const ids = new Set<string>();
  assert.ok(arenas.length >= 4);
  assert.ok(dictionary.length >= 30);
  assert.ok(grammarArticles.length >= 8);
  for (const arena of arenas) for (const lesson of arena.lessons) {
    assert.equal(lesson.arenaId, arena.id);
    assert.ok(lesson.exercises.length >= 6);
    for (const exercise of lesson.exercises) {
      assert.ok(!ids.has(exercise.id)); ids.add(exercise.id);
      assert.ok(exercise.hint && exercise.explanation && exercise.answer);
      if (exercise.type === 'choice') {
        assert.equal(exercise.options?.filter(option => option === exercise.answer).length, 1);
        assert.equal(new Set(exercise.options).size, exercise.options?.length);
      }
      if (exercise.type === 'build') assert.deepEqual([...exercise.options!].sort(), exercise.answer.split(/\s+/).sort());
      if (exercise.type === 'listen') assert.ok(exercise.audio);
    }
  }
  for (const entry of dictionary) assert.ok(grammarArticles.some(article => article.id === entry.grammarId));
});

test('supported topics use curated material and unsupported topics never masquerade as AI', () => {
  const profile = { age: '25+', level: 'A1', goals: ['travel'] };
  for (const topic of ['английский в аэропорту', 'отель', 'собеседование', 'Past Simple', 'say и tell', 'английский для программиста']) {
    const training = getTopicTraining(topic, profile);
    assert.ok(training);
    assert.equal(training.source, 'curated');
    assert.ok(training.exercises.length >= 6);
  }
  assert.equal(getTopicTraining('астрономия: спектральный анализ', profile), null);
  const child = getTopicTraining('собеседование', { ...profile, age: '0–14' });
  assert.ok(child?.title.includes('школе'));
  assert.ok(!child?.words.some(entry => entry.english === 'interview'));
});

test('personal-word training preserves translations and does not invent example sentences', () => {
  const exercises = createWordTraining([{ id: 'custom', english: 'quantum widget', russian: 'мой перевод' }]);
  assert.equal(exercises.length, 4);
  assert.equal(new Set(exercises.map(item => item.type)).size, 4);
  assert.equal(exercises.find(item => item.type === 'choice')?.answer, 'мой перевод');
  assert.equal(exercises.find(item => item.type === 'build')?.answer, 'quantum widget');
  assert.equal(createWordTraining([{ id: 'single', english: 'widget', russian: 'виджет' }]).length, 4);
  assert.deepEqual(createWordTraining([]), []);
});
