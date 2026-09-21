import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { studyLedgerError } from './ledger.mjs';
import { createLeague } from './league.mjs';
import { verifyCourseEvent, isPublishedActivity } from './course.mjs';
import { createPractice } from './practice.mjs';

const deriveKey = promisify(scrypt);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE = 'talkora_session';
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const BODY_LIMIT = 1024 * 1024;
const AUTH_WINDOW = 15 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.traineddata': 'application/octet-stream' };

export function defaultState() {
  return {
    profile: { age: '25+', goals: ['travel'], avatar: 'leaf', onboarded: false, level: 'A1', locale: 'ru', reminderEnabled: false, reminderTime: '19:00', reminderDays: [1, 2, 3, 4, 5] },
    progress: { xp: 0, coins: 0, streak: 0, bestStreak: 0, lastStudyDate: null, streakRestoredDate: null, completedLessons: [], passedArenas: [], dailyBonusDate: null, freeRestoreUsed: false, placementArena: 0 },
    words: [], history: [], reports: [],
  };
}

class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function requireValue(condition, message) {
  if (!condition) throw new HttpError(400, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textField(value, name, minimum, maximum) {
  requireValue(typeof value === 'string', `Поле «${name}» должно быть строкой.`);
  const result = value.trim();
  requireValue(result.length >= minimum && result.length <= maximum, `Проверьте длину поля «${name}» (${minimum}–${maximum}).`);
  return result;
}

function emailField(value) {
  const email = textField(value, 'Электронная почта', 3, 254).toLowerCase();
  requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email), 'Укажите корректную электронную почту.');
  return email;
}

function passwordField(value) {
  requireValue(typeof value === 'string' && value.length >= 8 && value.length <= 128, 'Пароль должен содержать от 8 до 128 символов.');
  return value;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64, SCRYPT_OPTIONS);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [salt, expected] = encoded.split(':');
  const actual = await deriveKey(password, salt, 64, SCRYPT_OPTIONS);
  const expectedBytes = Buffer.from(expected, 'hex');
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieToken(request) {
  const pair = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  const token = pair?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

async function readJson(request) {
  requireValue(/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || ''), 'Используйте Content-Type: application/json.');
  if (Number(request.headers['content-length']) > BODY_LIMIT) throw new HttpError(413, 'Запрос слишком большой (максимум 1 МиБ).');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, 'Запрос слишком большой (максимум 1 МиБ).');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Не удалось прочитать JSON.'); }
  requireValue(isObject(value), 'Тело запроса должно быть объектом JSON.');
  return value;
}

function validateJsonTree(value) {
  let count = 0;
  function visit(item, depth) {
    requireValue(depth <= 12 && ++count <= 30000, 'Слишком сложная структура данных.');
    if (typeof item === 'string') requireValue(item.length <= 16000, 'Слишком длинный текст.');
    if (Array.isArray(item)) item.forEach((child) => visit(child, depth + 1));
    else if (isObject(item)) {
      for (const [key, child] of Object.entries(item)) {
        requireValue(!['__proto__', 'prototype', 'constructor'].includes(key), 'Недопустимое поле данных.');
        visit(child, depth + 1);
      }
    }
  }
  visit(value, 0);
}

function validateState(state) {
  requireValue(isObject(state) && isObject(state.profile) && isObject(state.progress), 'В состоянии отсутствует профиль или прогресс.');
  validateJsonTree(state);
  const { profile, progress } = state;
  requireValue(['0-14', '15-24', '25+'].includes(profile.age), 'Неизвестная возрастная группа.');
  requireValue(['ru', 'en'].includes(profile.locale), 'Неизвестный язык интерфейса.');
  requireValue(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(profile.level), 'Неизвестный уровень CEFR.');
  requireValue(typeof profile.onboarded === 'boolean', 'Некорректное состояние знакомства с приложением.');
  requireValue(Array.isArray(profile.goals) && profile.goals.length <= 6 && profile.goals.every((goal) => ['travel', 'work', 'study', 'social', 'exams', 'personal', 'communication', 'self'].includes(goal)), 'Некорректные цели обучения.');
  textField(profile.avatar, 'Аватар', 1, 80);
  requireValue(typeof profile.reminderEnabled === 'boolean', 'Некорректная настройка напоминаний.');
  requireValue(typeof profile.reminderTime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(profile.reminderTime), 'Некорректное время напоминаний.');
  requireValue(Array.isArray(profile.reminderDays) && profile.reminderDays.length <= 7 && profile.reminderDays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6), 'Некорректные дни напоминаний.');
  for (const field of ['xp', 'coins', 'streak', 'placementArena']) {
    requireValue(Number.isSafeInteger(progress[field]) && progress[field] >= 0 && progress[field] <= 100000000, `Некорректное значение: ${field}.`);
  }
  requireValue(progress.bestStreak === undefined || (Number.isSafeInteger(progress.bestStreak) && progress.bestStreak >= progress.streak && progress.bestStreak <= 100000000), 'Некорректная лучшая серия занятий.');
  requireValue(progress.streakRestoredDate === undefined || progress.streakRestoredDate === null || (typeof progress.streakRestoredDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(progress.streakRestoredDate)), 'Некорректная дата восстановления серии.');
  for (const field of ['lastStudyDate', 'dailyBonusDate']) {
    requireValue(progress[field] === null || (typeof progress[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(progress[field])), `Некорректная дата: ${field}.`);
  }
  requireValue(typeof progress.freeRestoreUsed === 'boolean', 'Некорректное состояние восстановления серии.');
  for (const field of ['completedLessons', 'passedArenas']) {
    requireValue(Array.isArray(progress[field]) && progress[field].length <= 10000 && progress[field].every((id) => (typeof id === 'string' && id.length <= 100) || (Number.isSafeInteger(id) && id >= 0)), `Некорректный список: ${field}.`);
  }
  for (const [field, maximum] of [['words', 10000], ['history', 5000], ['reports', 1000]]) {
    requireValue(Array.isArray(state[field]) && state[field].length <= maximum && state[field].every(isObject), `Некорректный список: ${field}.`);
  }
  return state;
}

function publicUser(user) {
  return { id: user.id, email: user.email, nickname: user.nickname };
}

export function createServer({ dbPath = process.env.DB_PATH || resolve(ROOT, 'data/talkora.sqlite'), staticDir = resolve(ROOT, 'dist'), allowedOrigins = (process.env.APP_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean), leagueNow = () => new Date(), streakNow = () => new Date() } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_states (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS support_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      technical TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const practice = createPractice(database, leagueNow);
  const verifyEvent = (userId, state, event) => {
    const dynamic = practice.verifyEvent(userId, state, event);
    return dynamic.handled ? dynamic : verifyCourseEvent(state, event);
  };
  const league = createLeague(database, leagueNow, verifyEvent);
  database.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  const attempts = new Map();

  function snapshot(userId) {
    const row = database.prepare('SELECT payload, version FROM user_states WHERE user_id = ?').get(userId);
    return { state: JSON.parse(row.payload), version: row.version };
  }

  function authenticate(request) {
    const token = cookieToken(request);
    if (!token) return null;
    return database.prepare(`SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash(token), Date.now()) || null;
  }

  function requireUser(request) {
    const user = authenticate(request);
    if (!user) throw new HttpError(401, 'Войдите в аккаунт, чтобы продолжить.');
    return user;
  }

  function requireActor(request, body) {
    const user = requireUser(request);
    if (body.userId !== undefined && body.userId !== user.id) throw new HttpError(403, 'Аккаунт изменился. Войдите заново перед сохранением данных.');
    return user;
  }

  function secureRequest(request) {
    return Boolean(request.socket.encrypted) || allowedOrigins.some((origin) => origin.startsWith('https://') && origin === request.headers.origin);
  }

  function setSessionCookie(response, request, token, expired = false) {
    const origin = request.headers.origin;
    const crossSite = typeof origin === 'string' && allowedOrigins.includes(origin) &&
      origin.startsWith('https://') && new URL(origin).host !== request.headers.host;
    response.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=${crossSite ? 'None' : 'Lax'}; Max-Age=${expired ? 0 : SESSION_AGE / 1000}${secureRequest(request) ? '; Secure' : ''}`);
  }

  function issueSession(userId, response, request) {
    const oldToken = cookieToken(request);
    if (oldToken) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(oldToken));
    database.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    database.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, Date.now() + SESSION_AGE);
    setSessionCookie(response, request, token);
  }

  function checkOrigin(request) {
    let origin = request.headers.origin;
    if (!origin && request.headers.referer) {
      try { origin = new URL(request.headers.referer).origin; } catch { /* Invalid referrers are rejected below. */ }
    }
    const expected = `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`;
    let localHost = false;
    try { localHost = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(expected).hostname); } catch { /* Malformed hosts never become trusted origins. */ }
    if (!origin || (!allowedOrigins.includes(origin) && !(localHost && origin === expected))) throw new HttpError(403, 'Запрос отклонён: источник не совпадает с приложением.');
    return origin;
  }

  function rateLimit(request, response) {
    const now = Date.now();
    const ip = request.socket.remoteAddress || 'unknown';
    for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
    const entry = attempts.get(ip) || { count: 0, resetAt: now + AUTH_WINDOW };
    entry.count += 1;
    attempts.set(ip, entry);
    if (entry.count > 20) {
      response.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new HttpError(429, 'Слишком много попыток входа. Попробуйте через 15 минут.');
    }
  }

  function json(response, status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  }

  async function api(request, response, pathname) {
    const method = request.method;
    if (MUTATIONS.has(method) || method === 'OPTIONS') {
      const origin = checkOrigin(request);
      if (allowedOrigins.includes(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
        response.setHeader('Vary', 'Origin');
      }
    } else if (allowedOrigins.includes(request.headers.origin)) {
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }
    if (method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
      response.end();
      return;
    }
    if (method === 'GET' && pathname === '/api/health') return json(response, 200, { ok: true, service: 'Talkora', mode: 'prototype' });
    if (method === 'GET' && pathname === '/api/session') {
      const user = authenticate(request);
      return json(response, 200, user ? { user: publicUser(user), ...snapshot(user.id) } : { user: null });
    }
    if (method === 'POST' && pathname === '/api/auth/register') {
      rateLimit(request, response);
      const body = await readJson(request);
      const email = emailField(body.email);
      const password = passwordField(body.password);
      const nickname = textField(body.nickname, 'Никнейм', 3, 24).normalize('NFKC');
      requireValue(/^[\p{L}\p{N}_-]{3,24}$/u.test(nickname), 'Никнейм: 3–24 буквы, цифры, дефис или подчёркивание.');
      const passwordHash = await hashPassword(password);
      const user = { id: randomUUID(), email, nickname };
      const created = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare('INSERT INTO users(id, email, nickname, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, email, nickname, passwordHash, created);
        database.prepare('INSERT INTO user_states(user_id, payload, version, updated_at) VALUES (?, ?, 0, ?)').run(user.id, JSON.stringify(defaultState()), created);
        league.ensureMembership(user.id);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message)) throw new HttpError(409, 'Такая почта или никнейм уже используются.');
        throw error;
      }
      issueSession(user.id, response, request);
      return json(response, 201, { user, ...snapshot(user.id) });
    }
    if (method === 'POST' && pathname === '/api/auth/login') {
      rateLimit(request, response);
      const body = await readJson(request);
      const email = emailField(body.email);
      const password = passwordField(body.password);
      const user = database.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const encoded = user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
      const valid = await verifyPassword(password, encoded);
      if (!user || !valid) throw new HttpError(401, 'Почта или пароль указаны неверно.');
      if (!database.prepare('SELECT id FROM users WHERE id = ? AND password_hash = ?').get(user.id, encoded)) throw new HttpError(401, 'Аккаунт больше недоступен.');
      issueSession(user.id, response, request);
      return json(response, 200, { user: publicUser(user), ...snapshot(user.id) });
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const body = await readJson(request);
      if (body.userId !== undefined) requireActor(request, body);
      const token = cookieToken(request);
      if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
      setSessionCookie(response, request, '', true);
      return json(response, 200, { ok: true });
    }
    if (method === 'GET' && pathname === '/api/state') {
      const user = requireUser(request);
      return json(response, 200, snapshot(user.id));
    }
    if (method === 'GET' && pathname === '/api/league') {
      const user = requireUser(request);
      return json(response, 200, league.standings(user.id));
    }
    if (method === 'POST' && pathname === '/api/practice/words') {
      const body = await readJson(request);
      const user = requireActor(request, body);
      requireValue([5, 10, 15].includes(body.minutes), 'Выберите длительность 5, 10 или 15 минут.');
      requireValue(Array.isArray(body.words) && body.words.length >= 2 && body.words.length <= 12, 'Для тренировки нужно от 2 до 12 слов.');
      const words = body.words.map((word, index) => {
        requireValue(isObject(word), `Проверьте слово ${index + 1}.`);
        return {
          id: textField(word.id, `Идентификатор слова ${index + 1}`, 1, 100),
          english: textField(word.english, `Английское слово ${index + 1}`, 1, 200),
          russian: textField(word.russian, `Перевод ${index + 1}`, 1, 300),
        };
      });
      requireValue(new Set(words.map(word => word.id)).size === words.length, 'В тренировке есть повторяющиеся слова.');
      return json(response, 201, practice.createWords(user.id, words, body.minutes));
    }
    if (method === 'PUT' && pathname === '/api/state') {
      const body = await readJson(request);
      const user = requireActor(request, body);
      requireValue(Number.isSafeInteger(body.version) && body.version >= 0, 'Укажите версию состояния.');
      const state = validateState(body.state);
      const previous = snapshot(user.id);
      if (body.version !== previous.version) return json(response, 409, { error: 'Прогресс изменился на другом устройстве. Обновите данные перед сохранением.', ...previous });
      const ledgerError = studyLedgerError(previous.state, state, { verifyEvent: (before, event) => verifyEvent(user.id, before, event), isPublishedActivity });
      if (ledgerError) throw new HttpError(400, ledgerError);
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = database.prepare('UPDATE user_states SET payload = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?').run(JSON.stringify(state), new Date().toISOString(), user.id, body.version);
        if (!result.changes) {
          database.exec('ROLLBACK');
          return json(response, 409, { error: 'Прогресс изменился на другом устройстве. Обновите данные перед сохранением.', ...snapshot(user.id) });
        }
        league.recordEvents(user.id, previous.state, state);
        database.exec('COMMIT');
      } catch (error) {
        try { database.exec('ROLLBACK'); } catch { /* A failed COMMIT may have closed the transaction already. */ }
        throw error;
      }
      return json(response, 200, snapshot(user.id));
    }
    if (method === 'POST' && pathname === '/api/streak/restore') {
      const body = await readJson(request);
      const user = requireActor(request, body);
      requireValue(typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day), 'Укажите день восстановления в формате YYYY-MM-DD.');
      const now = streakNow();
      const dayTime = Date.parse(`${body.day}T00:00:00.000Z`);
      const serverDay = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
      requireValue(Number.isFinite(dayTime) && Math.abs(dayTime - serverDay) <= 86_400_000, 'Восстановить серию можно только в текущий день.');
      const previous = snapshot(user.id);
      const progress = previous.state.progress;
      const last = progress.lastStudyDate && Date.parse(`${progress.lastStudyDate}T00:00:00.000Z`);
      requireValue(progress.streak > 0 && Number.isFinite(last) && dayTime - last === 2 * 86_400_000 && progress.streakRestoredDate !== body.day, 'Эта серия сейчас не нуждается в восстановлении.');
      const cost = progress.freeRestoreUsed ? 20 : 0;
      requireValue(progress.coins >= cost, `Для восстановления нужно ${cost} кристаллов.`);
      const state = structuredClone(previous.state);
      state.progress.coins -= cost;
      state.progress.freeRestoreUsed = true;
      state.progress.streakRestoredDate = body.day;
      state.progress.bestStreak = Math.max(progress.bestStreak ?? 0, progress.streak);
      state.history.push({ id: randomUUID(), date: now.toISOString(), title: 'Восстановление серии', kind: 'streak_restore', restoreDate: body.day, xp: 0, coins: -cost });
      const error = studyLedgerError(previous.state, state, { allowRestore: true, verifyEvent: (before, event) => verifyEvent(user.id, before, event), isPublishedActivity });
      if (error) throw new HttpError(400, error);
      database.prepare('UPDATE user_states SET payload = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?').run(JSON.stringify(state), now.toISOString(), user.id, previous.version);
      return json(response, 200, { ...snapshot(user.id), cost });
    }
    if (method === 'POST' && pathname === '/api/support') {
      const body = await readJson(request);
      const user = requireActor(request, body);
      const category = textField(body.category, 'Категория', 1, 80);
      const message = textField(body.message, 'Сообщение', 5, 5000);
      if (body.technical !== undefined) {
        requireValue(isObject(body.technical) && JSON.stringify(body.technical).length <= 8000, 'Технические данные должны быть небольшим JSON-объектом.');
        validateJsonTree(body.technical);
      }
      const report = { id: randomUUID(), category, message, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO support_reports(id, user_id, category, message, technical, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(report.id, user.id, category, message, body.technical ? JSON.stringify(body.technical) : null, report.createdAt);
      return json(response, 201, { report });
    }
    if (method === 'DELETE' && pathname === '/api/account') {
      rateLimit(request, response);
      const body = await readJson(request);
      const user = requireActor(request, body);
      const password = passwordField(body.password);
      if (!(await verifyPassword(password, user.password_hash))) throw new HttpError(401, 'Неверный пароль. Аккаунт не удалён.');
      requireActor(request, body);
      database.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      setSessionCookie(response, request, '', true);
      return json(response, 200, { ok: true });
    }
    throw new HttpError(404, 'Такого API-метода нет.');
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/') || pathname === '/api') return await api(request, response, pathname);
      if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Метод не поддерживается.');
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Некорректный адрес.'); }
      if (decoded.includes('\0')) throw new HttpError(400, 'Некорректный адрес.');
      const root = resolve(staticDir);
      let file = resolve(root, `.${decoded}`);
      if (file !== root && !file.startsWith(`${root}${sep}`)) throw new HttpError(403, 'Недопустимый путь.');
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (extname(decoded)) throw new HttpError(404, 'Файл не найден.');
        file = resolve(root, 'index.html');
      }
      if (!existsSync(file)) throw new HttpError(404, 'Сначала соберите интерфейс: npm run build.');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      response.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' || file.endsWith(`${sep}sw.js`) ? 'no-cache' : 'public, max-age=3600' });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      if (!(error instanceof HttpError)) console.error('Talkora request failed:', error.code || error.name);
      json(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Внутренняя ошибка сервера. Попробуйте позже.', ...(error.details || {}) });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => database.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => console.log(`Talkora prototype: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
