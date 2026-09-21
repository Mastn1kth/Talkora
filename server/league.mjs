import { randomUUID } from 'node:crypto';

export const LEAGUE_NAMES = ['Лига открытий', 'Лига путешествий', 'Лига уверенности', 'Лига мастерства', 'Лига легенд'];
const GROUP_SIZE = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function weekStart(value) {
  const date = new Date(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export function createLeague(database, now = () => new Date(), verifyEvent = () => ({ verified: false })) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS league_groups (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL,
      tier INTEGER NOT NULL,
      activity_band INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS league_groups_week ON league_groups(week_start, tier, activity_band);
    CREATE TABLE IF NOT EXISTS league_memberships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      group_id TEXT NOT NULL REFERENCES league_groups(id) ON DELETE CASCADE,
      tier INTEGER NOT NULL,
      PRIMARY KEY (user_id, week_start)
    );
    CREATE INDEX IF NOT EXISTS league_members_group ON league_memberships(group_id);
    CREATE TABLE IF NOT EXISTS league_events (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      xp INTEGER NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS league_events_week ON league_events(week_start, user_id);
  `);
  if (!database.prepare('PRAGMA table_info(league_events)').all().some((column) => column.name === 'verified')) {
    database.exec('ALTER TABLE league_events ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
  }
  // Preserve study points earned before the league ledger was introduced. New
  // events are assigned by server receipt time in recordEvents below.
  const backfill = database.prepare('INSERT OR IGNORE INTO league_events(user_id, event_id, week_start, xp, verified) VALUES (?, ?, ?, ?, ?)');
  for (const row of database.prepare('SELECT user_id, payload FROM user_states').all()) {
    let history;
    try { history = JSON.parse(row.payload).history; } catch { continue; }
    if (!Array.isArray(history)) continue;
    for (const event of history) {
      if (typeof event?.id === 'string' && event.id.length <= 100 && Number.isSafeInteger(event.xp) && event.xp > 0 && event.xp <= 50 && typeof event.date === 'string' && Number.isFinite(Date.parse(event.date))) {
        backfill.run(row.user_id, event.id, weekStart(event.date), event.xp, 0);
      }
    }
  }

  function rows(groupId, week) {
    const members = database.prepare(`
      SELECT users.id AS userId, users.nickname, states.payload,
        COALESCE(SUM(events.xp), 0) AS xp
      FROM league_memberships AS members
      JOIN users ON users.id = members.user_id
      JOIN user_states AS states ON states.user_id = members.user_id
      LEFT JOIN league_events AS events ON events.user_id = members.user_id AND events.week_start = members.week_start AND events.verified = 1
      WHERE members.group_id = ? AND members.week_start = ?
      GROUP BY users.id, users.nickname, states.payload
    `).all(groupId, week);
    return members.map((member) => ({
      userId: member.userId,
      nickname: member.nickname,
      avatar: JSON.parse(member.payload).profile.avatar,
      xp: member.xp,
    })).sort((a, b) => b.xp - a.xp || a.nickname.localeCompare(b.nickname, 'ru') || a.userId.localeCompare(b.userId))
      .map((member, index) => ({ ...member, rank: index + 1 }));
  }

  function previousResult(userId, currentWeek) {
    const prior = database.prepare('SELECT * FROM league_memberships WHERE user_id = ? AND week_start < ? ORDER BY week_start DESC LIMIT 1').get(userId, currentWeek);
    if (!prior) return null;
    const ranked = rows(prior.group_id, prior.week_start);
    const self = ranked.find((row) => row.userId === userId);
    const immediatelyPrevious = Date.parse(`${currentWeek}T00:00:00.000Z`) - Date.parse(`${prior.week_start}T00:00:00.000Z`) === WEEK_MS;
    const movers = ranked.length >= 3 ? Math.min(3, Math.max(1, Math.floor(ranked.length / 4))) : 0;
    const movement = immediatelyPrevious && movers && self.xp > 0 && self.rank <= movers ? 1
      : immediatelyPrevious && movers && self.rank > ranked.length - movers ? -1 : 0;
    return { weekStart: prior.week_start, tier: prior.tier, rank: self.rank, participants: ranked.length, xp: self.xp, movement };
  }

  function ensureMembership(userId, currentWeek = weekStart(now())) {
    const present = database.prepare('SELECT * FROM league_memberships WHERE user_id = ? AND week_start = ?').get(userId, currentWeek);
    if (present) return present;
    const previous = previousResult(userId, currentWeek);
    const tier = Math.max(0, Math.min(LEAGUE_NAMES.length - 1, (previous?.tier ?? 0) + (previous?.movement ?? 0)));
    const previousWeek = new Date(Date.parse(`${currentWeek}T00:00:00.000Z`) - WEEK_MS).toISOString().slice(0, 10);
    const previousXp = database.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM league_events WHERE user_id = ? AND week_start = ? AND verified = 1').get(userId, previousWeek).xp;
    const band = Math.min(9, Math.floor(previousXp / 150));
    let group = database.prepare(`
      SELECT groups.id FROM league_groups AS groups
      LEFT JOIN league_memberships AS members ON members.group_id = groups.id
      WHERE groups.week_start = ? AND groups.tier = ? AND groups.activity_band = ?
      GROUP BY groups.id HAVING COUNT(members.user_id) < ?
      ORDER BY COUNT(members.user_id) DESC, groups.created_at ASC LIMIT 1
    `).get(currentWeek, tier, band, GROUP_SIZE);
    if (!group) {
      group = { id: randomUUID() };
      database.prepare('INSERT INTO league_groups(id, week_start, tier, activity_band, created_at) VALUES (?, ?, ?, ?, ?)').run(group.id, currentWeek, tier, band, now().toISOString());
    }
    database.prepare('INSERT INTO league_memberships(user_id, week_start, group_id, tier) VALUES (?, ?, ?, ?)').run(userId, currentWeek, group.id, tier);
    return { user_id: userId, week_start: currentWeek, group_id: group.id, tier };
  }

  function recordEvents(userId, previous, next) {
    const week = weekStart(now());
    ensureMembership(userId, week);
    const oldIds = new Set(previous.history.map((event) => event.id));
    const insert = database.prepare('INSERT INTO league_events(user_id, event_id, week_start, xp, verified) VALUES (?, ?, ?, ?, ?)');
    const completed = new Set(previous.progress.completedLessons);
    for (const event of next.history) {
      if (oldIds.has(event.id) || event.xp <= 0) continue;
      const verification = verifyEvent(userId, { ...previous, progress: { ...previous.progress, completedLessons: [...completed] } }, event);
      const verified = verification.verified ? 1 : 0;
      if (verification.verified) completed.add(verification.activityId);
      insert.run(userId, event.id, week, event.xp, verified);
    }
  }

  function standings(userId) {
    const week = weekStart(now());
    const membership = ensureMembership(userId, week);
    const ranked = rows(membership.group_id, week);
    const end = new Date(Date.parse(`${week}T00:00:00.000Z`) + WEEK_MS).toISOString();
    return {
      weekStart: week,
      weekEnd: end,
      tier: membership.tier,
      name: LEAGUE_NAMES[membership.tier],
      selfRank: ranked.find((row) => row.userId === userId)?.rank,
      rows: ranked.map(({ userId: memberId, ...row }) => ({ ...row, self: memberId === userId })),
      previousResult: previousResult(userId, week),
    };
  }

  return { ensureMembership, recordEvents, standings };
}
