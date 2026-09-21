import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createServer, defaultState } from '../server/index.mjs';

const course = JSON.parse(readFileSync(new URL('../server/course.generated.json', import.meta.url), 'utf8'));

function award(state, id, xp, day = new Date().toISOString().slice(0, 10)) {
  state.history.push({ id, date: `${day}T12:00:00.000Z`, studyDate: day, title: id, xp, coins: 5, accuracy: 100 });
  state.progress.xp += xp;
  state.progress.coins += 5;
  if (state.progress.lastStudyDate !== day) {
    const gap = state.progress.lastStudyDate ? Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${state.progress.lastStudyDate}T00:00:00.000Z`) : 0;
    state.progress.streak = gap === 86_400_000 ? state.progress.streak + 1 : 1;
    state.progress.lastStudyDate = day;
  }
  state.progress.bestStreak = Math.max(state.progress.bestStreak ?? 0, state.progress.streak);
  return state;
}

function awardCourse(state, contentId, correct = true, day = new Date().toISOString().slice(0, 10)) {
  const activity = course.activities[contentId];
  const exerciseIds = activity.allowedExerciseSets[0];
  const responses = exerciseIds.map((exerciseId) => ({ exerciseId, answer: correct ? activity.answers[exerciseId] : '__wrong__' }));
  const accuracy = correct ? 100 : 0;
  const passed = activity.mode !== 'gate' || accuracy >= 75;
  const activityId = activity.mode === 'gate' && !passed ? `${contentId}-practice` : contentId;
  const firstCompletion = !state.progress.completedLessons.includes(activityId);
  const baseXp = activity.mode === 'gate' ? (passed ? 50 : 10) : 30;
  const xp = firstCompletion ? baseXp : Math.min(baseXp, 10);
  award(state, `verified-${contentId}-${correct}-${state.history.length}`, xp, day);
  Object.assign(state.history.at(-1), { title: activity.title, accuracy, proof: { contentId, activityId, responses } });
  if (firstCompletion) state.progress.completedLessons.push(activityId);
  if (activity.mode === 'gate' && passed && !state.progress.passedArenas.includes(activity.arenaId)) {
    state.progress.passedArenas.push(activity.arenaId);
  }
  return state;
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'talkora-api-'));
  const dbPath = join(directory, 'db.sqlite');
  const server = createServer({ dbPath, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  async function close() {
    if (!closed) {
      closed = true;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
  t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function register(suffix = 'one') {
    const result = await request('/api/auth/register', { method: 'POST', body: { email: `${suffix}@example.test`, password: 'correct horse battery', nickname: `Learner_${suffix}` } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result;
  }
  return { request, register, origin, dbPath, directory, close, server };
}

test('registration, persistent session and logout use private cookie sessions', async (t) => {
  const app = await fixture(t);
  assert.deepEqual((await app.request('/api/session')).data, { user: null });
  const registered = await app.register();
  assert.match(registered.headers.get('set-cookie'), /HttpOnly/);
  assert.match(registered.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal(registered.data.version, 0);
  assert.equal(registered.data.user.nickname, 'Learner_one');
  assert.deepEqual(registered.data.state, defaultState());
  assert.equal('password_hash' in registered.data.user, false);
  const session = await app.request('/api/session', { cookie: registered.cookie });
  assert.equal(session.data.user.id, registered.data.user.id);
  const invalid = await app.request('/api/auth/login', { method: 'POST', body: { email: 'one@example.test', password: 'incorrect password' } });
  assert.equal(invalid.status, 401);
  const logout = await app.request('/api/auth/logout', { method: 'POST', cookie: registered.cookie, body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await app.request('/api/session', { cookie: registered.cookie })).data.user, null);
  const login = await app.request('/api/auth/login', { method: 'POST', body: { email: 'ONE@example.test', password: 'correct horse battery' } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, registered.data.user.id);
  assert.notEqual(login.cookie, registered.cookie);
});

test('accounts cannot read or overwrite another account state', async (t) => {
  const app = await fixture(t);
  const first = await app.register('alice');
  const second = await app.register('bob');
  const state = first.data.state;
  state.words.push({ id: 'private', word: 'hello', translation: 'привет' });
  award(state, 'first-private-lesson', 15);
  const saved = await app.request('/api/state', { method: 'PUT', cookie: first.cookie, body: { state, version: 0, userId: first.data.user.id } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.version, 1);
  const secondState = await app.request(`/api/state?userId=${first.data.user.id}`, { cookie: second.cookie });
  assert.equal(secondState.data.state.words.length, 0);
  assert.equal(secondState.data.state.progress.xp, 0);
  assert.equal((await app.request('/api/state')).status, 401);
  assert.equal((await app.request('/api/state', { cookie: 'talkora_session=attacker' })).status, 401);
});

test('stale account requests cannot overwrite, inspect, log out or delete the current account', async (t) => {
  const app = await fixture(t);
  const first = await app.register('first');
  const second = await app.register('second');
  first.data.state.progress.xp = 500;
  const mismatched = await app.request('/api/state', { method: 'PUT', cookie: second.cookie, body: { userId: first.data.user.id, state: first.data.state, version: 0 } });
  assert.equal(mismatched.status, 403);
  assert.deepEqual(Object.keys(mismatched.data), ['error']);
  const staleVersion = await app.request('/api/state', { method: 'PUT', cookie: second.cookie, body: { userId: first.data.user.id, state: first.data.state, version: 9 } });
  assert.equal(staleVersion.status, 403);
  assert.equal('state' in staleVersion.data, false);
  for (const [path, method, extra] of [
    ['/api/auth/logout', 'POST', {}],
    ['/api/account', 'DELETE', { password: 'correct horse battery' }],
    ['/api/support', 'POST', { category: 'translation', message: 'A private report from a stale tab.' }],
  ]) {
    assert.equal((await app.request(path, { method, cookie: second.cookie, body: { userId: first.data.user.id, ...extra } })).status, 403);
  }
  const current = await app.request('/api/session', { cookie: second.cookie });
  assert.equal(current.data.user.id, second.data.user.id);
  assert.equal(current.data.state.progress.xp, 0);
  assert.equal(current.data.version, 0);
  assert.equal((await app.request('/api/state', { cookie: first.cookie })).data.state.progress.xp, 0);
});

test('a request whose session is logged out while its body uploads cannot save or delete', async (t) => {
  for (const [method, path] of [['PUT', '/api/state'], ['DELETE', '/api/account']]) {
    const app = await fixture(t);
    const registered = await app.register();
    const body = JSON.stringify(method === 'PUT'
      ? { userId: registered.data.user.id, version: 0, state: { ...registered.data.state, progress: { ...registered.data.state.progress, xp: 900 } } }
      : { userId: registered.data.user.id, password: 'correct horse battery' });
    const arrived = once(app.server, 'request');
    let pending;
    const result = new Promise((resolve, reject) => {
      pending = http.request(`${app.origin}${path}`, { method, headers: { Origin: app.origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Cookie: registered.cookie } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      pending.on('error', reject);
    });
    pending.write(body.slice(0, 1));
    await arrived;
    const logout = await app.request('/api/auth/logout', { method: 'POST', cookie: registered.cookie, body: { userId: registered.data.user.id } });
    assert.equal(logout.status, 200);
    pending.end(body.slice(1));
    assert.equal((await result).status, 401);
    const login = await app.request('/api/auth/login', { method: 'POST', body: { email: registered.data.user.email, password: 'correct horse battery' } });
    assert.equal(login.status, 200);
    assert.equal(login.data.state.progress.xp, 0);
    assert.equal(login.data.version, 0);
  }
});

test('optimistic versions reject stale writes without losing progress', async (t) => {
  const app = await fixture(t);
  const { cookie, data } = await app.register();
  const next = structuredClone(data.state);
  award(next, 'welcome-lesson', 40);
  next.progress.completedLessons = ['welcome-1'];
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie, body: { state: next, version: 0 } })).status, 200);
  const stale = await app.request('/api/state', { method: 'PUT', cookie, body: { state: data.state, version: 0 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.version, 1);
  assert.equal(stale.data.state.progress.xp, 40);
  assert.deepEqual(stale.data.state.progress.completedLessons, ['welcome-1']);
  next.profile.age = '0-14';
  const changedAge = await app.request('/api/state', { method: 'PUT', cookie, body: { state: next, version: 1 } });
  assert.equal(changedAge.status, 200);
  assert.equal(changedAge.data.state.progress.xp, 40);
});

test('study points follow an append-only journal and cannot be edited as counters', async (t) => {
  const app = await fixture(t);
  const { cookie, data } = await app.register();
  const counterOnly = structuredClone(data.state);
  counterOnly.progress.xp = 500;
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie, body: { state: counterOnly, version: 0 } })).status, 400);
  const forgedLargeEvent = award(structuredClone(data.state), 'large', 500);
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie, body: { state: forgedLargeEvent, version: 0 } })).status, 400);
  const valid = award(structuredClone(data.state), 'real-lesson', 30);
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie, body: { state: valid, version: 0 } })).status, 200);
  const falseStreak = structuredClone(valid);
  falseStreak.progress.streak = 30;
  falseStreak.progress.bestStreak = 30;
  falseStreak.progress.lastStudyDate = '2026-09-18';
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie, body: { state: falseStreak, version: 1 } })).status, 400);
  const repeated = structuredClone(valid);
  repeated.history.push({ ...repeated.history[0] });
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie, body: { state: repeated, version: 1 } })).status, 400);
  const modified = structuredClone(valid);
  modified.history[0].xp = 50;
  modified.progress.xp = 50;
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie, body: { state: modified, version: 1 } })).status, 400);
  const removed = structuredClone(valid);
  removed.history = [];
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie, body: { state: removed, version: 1 } })).status, 400);
  const next = award(structuredClone(valid), 'another-lesson', 20);
  const saved = await app.request('/api/state', { method: 'PUT', cookie, body: { state: next, version: 1 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.state.progress.xp, 50);
  assert.equal(saved.data.state.progress.coins, 10);
});

test('league points require server-checked course answers and arena gates cannot be forged', async (t) => {
  const app = await fixture(t, { leagueNow: () => new Date('2026-09-21T12:00:00.000Z') });
  const checked = await app.register('checked');
  const unchecked = await app.register('unchecked');
  const verified = awardCourse(structuredClone(checked.data.state), 'hello', true, '2026-09-21');
  const firstSave = await app.request('/api/state', { method: 'PUT', cookie: checked.cookie, body: { state: verified, version: 0 } });
  assert.equal(firstSave.status, 200);
  const repeated = awardCourse(structuredClone(firstSave.data.state), 'hello', true, '2026-09-21');
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: checked.cookie, body: { state: repeated, version: 1 } })).status, 200);
  const localOnly = award(structuredClone(unchecked.data.state), 'personal-words', 30, '2026-09-21');
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: unchecked.cookie, body: { state: localOnly, version: 0 } })).status, 200);
  const league = await app.request('/api/league', { cookie: checked.cookie });
  assert.deepEqual(league.data.rows.map((row) => row.xp), [40, 0]);

  const tampered = awardCourse(structuredClone(localOnly), 'hello', true, '2026-09-21');
  tampered.history.at(-1).proof.responses[0].answer = '__wrong__';
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: unchecked.cookie, body: { state: tampered, version: 1 } })).status, 400);
  const forgedArena = structuredClone(localOnly);
  forgedArena.progress.passedArenas.push('first-steps');
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: unchecked.cookie, body: { state: forgedArena, version: 1 } })).status, 400);
});

test('personal-word sessions are account-bound, checked by the server, and count in the league', async (t) => {
  const app = await fixture(t, { leagueNow: () => new Date('2026-09-21T12:00:00.000Z') });
  const learner = await app.register('wordlearner');
  const intruder = await app.register('wordintruder');
  const words = [
    { id: 'one', english: 'boarding pass', russian: 'посадочный талон' },
    { id: 'two', english: 'luggage', russian: 'багаж' },
    { id: 'three', english: 'gate', russian: 'выход' },
  ];
  const prepared = await app.request('/api/practice/words', { method: 'POST', cookie: learner.cookie, body: { userId: learner.data.user.id, words, minutes: 5 } });
  assert.equal(prepared.status, 201);
  assert.equal(prepared.data.exercises.length, 6);
  assert.equal(new Set(prepared.data.exercises.map((exercise) => exercise.type)).size >= 3, true);

  const completed = award(structuredClone(learner.data.state), 'checked-personal', 30, '2026-09-21');
  Object.assign(completed.history.at(-1), {
    title: prepared.data.title,
    accuracy: 100,
    proof: {
      sessionId: prepared.data.sessionId,
      activityId: prepared.data.activityId,
      responses: prepared.data.exercises.map((exercise) => ({ exerciseId: exercise.id, answer: exercise.answer })),
    },
  });
  completed.progress.completedLessons.push(prepared.data.activityId);
  const saved = await app.request('/api/state', { method: 'PUT', cookie: learner.cookie, body: { state: completed, version: 0 } });
  assert.equal(saved.status, 200);
  const league = await app.request('/api/league', { cookie: learner.cookie });
  assert.equal(league.data.rows.find((row) => row.self).xp, 30);

  const stolen = structuredClone(intruder.data.state);
  award(stolen, 'stolen-session', 30, '2026-09-21');
  Object.assign(stolen.history.at(-1), completed.history.at(-1), { id: 'stolen-session' });
  stolen.progress.completedLessons.push(prepared.data.activityId);
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: intruder.cookie, body: { state: stolen, version: 0 } })).status, 400);

  const tampered = structuredClone(saved.data.state);
  award(tampered, 'tampered-session', 10, '2026-09-21');
  Object.assign(tampered.history.at(-1), {
    title: prepared.data.title,
    accuracy: 100,
    proof: {
      sessionId: prepared.data.sessionId,
      activityId: prepared.data.activityId,
      responses: prepared.data.exercises.map((exercise, index) => ({ exerciseId: exercise.id, answer: index === 0 ? '__wrong__' : exercise.answer })),
    },
  });
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: learner.cookie, body: { state: tampered, version: 1 } })).status, 400);
});

test('curated topic sessions use the saved age and level, reject client changes, and count in the league', async (t) => {
  const app = await fixture(t, { leagueNow: () => new Date('2026-09-21T12:00:00.000Z') });
  const learner = await app.register('topiclearner');
  const profile = structuredClone(learner.data.state);
  profile.profile.age = '0-14';
  profile.profile.level = 'A1';
  profile.profile.onboarded = true;
  const profiled = await app.request('/api/state', { method: 'PUT', cookie: learner.cookie, body: { state: profile, version: 0 } });
  assert.equal(profiled.status, 200);

  assert.equal((await app.request('/api/practice/topic', { method: 'POST', cookie: learner.cookie,
    body: { topicId: 'unknown-topic', minutes: 5, userId: learner.data.user.id } })).status, 400);
  const prepared = await app.request('/api/practice/topic', { method: 'POST', cookie: learner.cookie,
    body: { topicId: 'interview', minutes: 15, userId: learner.data.user.id } });
  assert.equal(prepared.status, 201);
  assert.equal(prepared.data.title, 'Рассказываем о себе в школе');
  assert.equal(prepared.data.exercises.length, 14);
  assert.equal(prepared.data.words.some((word) => word.english === 'school'), true);
  assert.equal(prepared.data.words.some((word) => word.english === 'interview'), false);

  const completed = award(structuredClone(profiled.data.state), 'checked-topic', 30, '2026-09-21');
  Object.assign(completed.history.at(-1), {
    title: prepared.data.title,
    accuracy: 100,
    proof: {
      sessionId: prepared.data.sessionId,
      activityId: prepared.data.activityId,
      responses: prepared.data.exercises.map((exercise) => ({ exerciseId: exercise.id, answer: exercise.answer })),
    },
  });
  completed.progress.completedLessons.push(prepared.data.activityId);
  const changed = structuredClone(completed);
  changed.history.at(-1).title = 'Подменённая тема';
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: learner.cookie, body: { state: changed, version: 1 } })).status, 400);
  const saved = await app.request('/api/state', { method: 'PUT', cookie: learner.cookie, body: { state: completed, version: 1 } });
  assert.equal(saved.status, 200);
  const league = await app.request('/api/league', { cookie: learner.cookie });
  assert.equal(league.data.rows.find((row) => row.self).xp, 30);
});

test('streak recovery is free once, then spends twenty crystals exactly once', async (t) => {
  let current = new Date('2026-09-20T12:00:00.000Z');
  const app = await fixture(t, { streakNow: () => current });
  const account = await app.register('streak');
  const seed = structuredClone(account.data.state);
  for (let day = 13; day <= 18; day++) award(seed, `study-${day}`, 5, `2026-09-${day}`);
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: account.cookie, body: { state: seed, version: 0 } })).status, 200);

  const forged = structuredClone(seed);
  forged.progress.freeRestoreUsed = true;
  forged.progress.streakRestoredDate = '2026-09-20';
  forged.history.push({ id: 'forged-restore', date: current.toISOString(), title: 'Восстановление серии', kind: 'streak_restore', restoreDate: '2026-09-20', xp: 0, coins: 0 });
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: account.cookie, body: { state: forged, version: 1 } })).status, 400);
  const freeResult = await app.request('/api/streak/restore', { method: 'POST', cookie: account.cookie, body: { day: '2026-09-20' } });
  assert.equal(freeResult.status, 200);
  assert.equal(freeResult.data.cost, 0);
  assert.equal(freeResult.data.state.progress.freeRestoreUsed, true);
  assert.equal((await app.request('/api/streak/restore', { method: 'POST', cookie: account.cookie, body: { day: '2026-09-20' } })).status, 400);

  const studied = award(structuredClone(freeResult.data.state), 'after-recovery', 30, '2026-09-20');
  studied.progress.streak = 7;
  studied.progress.bestStreak = 7;
  studied.progress.dailyBonusDate = '2026-09-20';
  studied.progress.coins += 10;
  studied.history.push({ id: 'bonus-2026-09-20', date: '2026-09-20T12:01:00.000Z', title: 'Ежедневный подарок', xp: 0, coins: 10 });
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: account.cookie, body: { state: studied, version: 2 } })).status, 200);

  current = new Date('2026-09-22T12:00:00.000Z');
  const result = await app.request('/api/streak/restore', { method: 'POST', cookie: account.cookie, body: { day: '2026-09-22' } });
  assert.equal(result.status, 200);
  assert.equal(result.data.cost, 20);
  assert.equal(result.data.state.progress.coins, studied.progress.coins - 20);
  assert.equal(result.data.state.progress.streak, 7);
});

test('weekly leagues group real accounts, rank server-received points and reset next Monday', async (t) => {
  let current = new Date('2026-09-21T12:00:00.000Z');
  const app = await fixture(t, { leagueNow: () => current });
  const alice = await app.register('alice');
  const bob = await app.register('bob');
  const carol = await app.register('carol');
  assert.equal((await app.request('/api/league')).status, 401);
  for (const [account, contentId, correct] of [[alice, 'gate-first-steps', true], [bob, 'hello', true], [carol, 'gate-first-steps', false]]) {
    const state = awardCourse(structuredClone(account.data.state), contentId, correct);
    assert.equal((await app.request('/api/state', { method: 'PUT', cookie: account.cookie, body: { state, version: 0 } })).status, 200);
  }
  const first = await app.request('/api/league', { cookie: alice.cookie });
  assert.equal(first.status, 200);
  assert.equal(first.data.weekStart, '2026-09-21');
  assert.deepEqual(first.data.rows.map((row) => row.nickname), ['Learner_alice', 'Learner_bob', 'Learner_carol']);
  assert.deepEqual(first.data.rows.map((row) => row.xp), [50, 30, 10]);
  assert.equal(first.data.selfRank, 1);
  assert.equal('email' in first.data.rows[0], false);
  current = new Date('2026-09-28T12:00:00.000Z');
  const promoted = await app.request('/api/league', { cookie: alice.cookie });
  assert.equal(promoted.data.weekStart, '2026-09-28');
  assert.equal(promoted.data.tier, 1);
  assert.equal(promoted.data.rows[0].xp, 0);
  assert.deepEqual(promoted.data.previousResult, { weekStart: '2026-09-21', tier: 0, rank: 1, participants: 3, xp: 50, movement: 1 });
  const stayed = await app.request('/api/league', { cookie: bob.cookie });
  const bottom = await app.request('/api/league', { cookie: carol.cookie });
  assert.equal(stayed.data.tier, 0);
  assert.equal((await app.request('/api/league', { cookie: bob.cookie })).data.rows.length, 2);
  assert.equal(bottom.data.previousResult.movement, -1);
  assert.equal(bottom.data.tier, 0);
});

test('a weekly league group never exceeds twelve members', async (t) => {
  const app = await fixture(t);
  const members = [];
  for (let i = 0; i < 13; i++) members.push(await app.register(`member${i}`));
  const first = await app.request('/api/league', { cookie: members[0].cookie });
  const last = await app.request('/api/league', { cookie: members[12].cookie });
  assert.equal(first.data.rows.length, 12);
  assert.equal(last.data.rows.length, 1);
  assert.equal(first.data.rows.some((row) => row.nickname === members[12].data.user.nickname), false);
  assert.equal(last.data.rows[0].nickname, members[12].data.user.nickname);
});

test('an inactive group does not promote a participant because of alphabetical order', async (t) => {
  let current = new Date('2026-09-21T12:00:00.000Z');
  const app = await fixture(t, { leagueNow: () => current });
  const first = await app.register('alpha');
  await app.register('beta');
  await app.register('gamma');
  current = new Date('2026-09-28T12:00:00.000Z');
  const result = await app.request('/api/league', { cookie: first.cookie });
  assert.equal(result.data.tier, 0);
  assert.equal(result.data.previousResult.xp, 0);
  assert.equal(result.data.previousResult.movement, 0);
});

test('state and account requests validate shape, size, and unique identity', async (t) => {
  const app = await fixture(t);
  const first = await app.register();
  const duplicate = await app.request('/api/auth/register', { method: 'POST', body: { email: 'ONE@example.test', nickname: 'Another', password: 'long password' } });
  assert.equal(duplicate.status, 409);
  const broken = structuredClone(first.data.state);
  broken.progress.xp = -1;
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: first.cookie, body: { state: broken, version: 0 } })).status, 400);
  assert.equal((await app.request('/api/state', { method: 'PUT', cookie: first.cookie, body: { state: {}, version: 0 } })).status, 400);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body: { email: 'bad', nickname: 'ok', password: 'short' } })).status, 400);
  assert.equal((await app.request('/api/auth/login', { method: 'POST', body: '{broken' })).status, 400);
  assert.equal((await app.request('/api/auth/login', { method: 'POST', body: { large: 'x'.repeat(1024 * 1024) } })).status, 413);
});

test('cross-origin and missing-origin mutations are rejected before authentication', async (t) => {
  const app = await fixture(t);
  const body = { email: 'csrf@example.test', nickname: 'CSRFtest', password: 'long password' };
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body, headers: { Origin: '' } })).status, 403);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body, headers: { Origin: 'null' } })).status, 403);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body, headers: { Origin: 'http://evil.example', Host: 'evil.example' } })).status, 403);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } })).status, 400);
  const allowed = await app.request('/api/auth/register', { method: 'POST', body, headers: { Origin: '', Referer: `${app.origin}/login` } });
  assert.equal(allowed.status, 201);
});

test('explicit HTTPS origin receives secure cookies and a bounded credentialed CORS policy', async (t) => {
  const app = await fixture(t, { allowedOrigins: ['https://talkora.example'] });
  const preflight = await app.request('/api/auth/register', { method: 'OPTIONS', headers: { Origin: 'https://talkora.example' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://talkora.example');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const account = await app.request('/api/auth/register', { method: 'POST', headers: { Origin: 'https://talkora.example' }, body: { email: 'secure@example.test', nickname: 'SecureAccount', password: 'long password' } });
  assert.equal(account.status, 201);
  assert.match(account.headers.get('set-cookie'), /; Secure/);
  assert.match(account.headers.get('set-cookie'), /SameSite=None/);
  assert.equal((await app.request('/api/auth/register', { method: 'OPTIONS', headers: { Origin: 'https://other.example' } })).status, 403);
});

test('packaged Android origin can keep its HTTPS API session without opening CORS to other apps', async (t) => {
  const app = await fixture(t, { allowedOrigins: ['https://localhost'] });
  const origin = { Origin: 'https://localhost' };
  const preflight = await app.request('/api/auth/register', { method: 'OPTIONS', headers: origin });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const account = await app.request('/api/auth/register', { method: 'POST', headers: origin, body: { email: 'android@example.test', nickname: 'AndroidLearner', password: 'long password' } });
  assert.equal(account.status, 201);
  assert.match(account.headers.get('set-cookie'), /HttpOnly; SameSite=None/);
  assert.match(account.headers.get('set-cookie'), /; Secure/);
  const session = await app.request('/api/session', { cookie: account.cookie, headers: origin });
  assert.equal(session.status, 200);
  assert.equal(session.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal(session.data.user.id, account.data.user.id);
  const logout = await app.request('/api/auth/logout', { method: 'POST', cookie: account.cookie, headers: origin, body: { userId: account.data.user.id } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /SameSite=None/);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await app.request('/api/auth/register', { method: 'OPTIONS', headers: { Origin: 'https://other-localhost' } })).status, 403);
});

test('account deletion requires password and cascades state, sessions and private reports', async (t) => {
  const app = await fixture(t);
  const first = await app.register();
  const second = await app.register('other');
  const report = await app.request('/api/support', { method: 'POST', cookie: first.cookie, body: { category: 'translation', message: 'Проверьте перевод слова.', technical: { screen: 'lesson' } } });
  assert.equal(report.status, 201);
  const failed = await app.request('/api/account', { method: 'DELETE', cookie: first.cookie, body: { password: 'wrong password' } });
  assert.equal(failed.status, 401);
  assert.equal((await app.request('/api/session', { cookie: first.cookie })).data.user.id, first.data.user.id);
  const deleted = await app.request('/api/account', { method: 'DELETE', cookie: first.cookie, body: { password: 'correct horse battery' } });
  assert.equal(deleted.status, 200);
  assert.match(deleted.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await app.request('/api/session', { cookie: first.cookie })).data.user, null);
  assert.equal((await app.request('/api/session', { cookie: second.cookie })).data.user.id, second.data.user.id);
  await app.close();
  const database = new DatabaseSync(app.dbPath, { readOnly: true });
  try {
    for (const table of ['user_states', 'sessions', 'support_reports', 'league_memberships', 'league_events']) assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`).get(first.data.user.id).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  } finally { database.close(); }
});

test('state and session survive server restart; database contains a hash rather than a bearer token', async (t) => {
  const app = await fixture(t);
  const first = await app.register();
  award(first.data.state, 'first-lesson', 45);
  award(first.data.state, 'second-lesson', 45);
  await app.request('/api/state', { method: 'PUT', cookie: first.cookie, body: { state: first.data.state, version: 0 } });
  await app.close();
  const database = new DatabaseSync(app.dbPath, { readOnly: true });
  try {
    const row = database.prepare('SELECT password_hash FROM users').get();
    assert.match(row.password_hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
    assert.notEqual(database.prepare('SELECT token_hash FROM sessions').get().token_hash, first.cookie.split('=')[1]);
  } finally { database.close(); }
  const legacyDatabase = new DatabaseSync(app.dbPath);
  legacyDatabase.exec('DELETE FROM league_events');
  legacyDatabase.close();
  const reopened = createServer({ dbPath: app.dbPath });
  reopened.listen(0, '127.0.0.1');
  await once(reopened, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${reopened.address().port}/api/session`, { headers: { Cookie: first.cookie } });
    const data = await response.json();
    assert.equal(data.state.progress.xp, 90);
    assert.equal(data.version, 1);
    const leagueResponse = await fetch(`http://127.0.0.1:${reopened.address().port}/api/league`, { headers: { Cookie: first.cookie } });
    const league = await leagueResponse.json();
    assert.equal(league.rows[0].xp, 0);
  } finally { await new Promise((resolve) => reopened.close(resolve)); }
});

test('login rate limit bounds repeated password attempts', async (t) => {
  const app = await fixture(t);
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await app.request('/api/auth/login', { method: 'POST', body: {} });
    assert.equal(response.status, 400);
  }
  const limited = await app.request('/api/auth/login', { method: 'POST', body: {} });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('static build serves SPA routes but never substitutes HTML for missing assets or APIs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'talkora-static-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Talkora</title>');
  await writeFile(join(directory, 'assets', 'app.js'), 'console.log("Talkora")');
  await writeFile(join(directory, 'assets', 'worker.mjs'), 'self.onmessage=()=>{}');
  await writeFile(join(directory, 'assets', 'engine.wasm'), new Uint8Array([0, 97, 115, 109]));
  await writeFile(join(directory, 'assets', 'language.traineddata'), new Uint8Array([0, 1]));
  const app = await fixture(t, { staticDir: directory });
  const home = await app.request('/learn');
  assert.equal(home.status, 200);
  assert.match(home.data, /Talkora/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(home.headers.get('content-security-policy'), /worker-src 'self'/);
  assert.equal((await app.request('/assets/app.js')).status, 200);
  assert.match((await app.request('/assets/worker.mjs')).headers.get('content-type'), /text\/javascript/);
  assert.match((await app.request('/assets/engine.wasm')).headers.get('content-type'), /application\/wasm/);
  assert.match((await app.request('/assets/language.traineddata')).headers.get('content-type'), /application\/octet-stream/);
  assert.equal((await app.request('/missing.js')).status, 404);
  assert.equal((await app.request('/api/missing')).status, 404);
});
