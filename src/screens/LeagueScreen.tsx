import { useCallback, useEffect, useState } from 'react';
import { CircleHelp, Flower2, Gem, Leaf, Mountain, RotateCcw, Sun, Trophy } from 'lucide-react';
import { Empty, SectionTitle } from '../components';
import { api, useStore } from '../lib/store';

type LeagueRow = { nickname: string; avatar: string; xp: number; rank: number; self: boolean };
type LeagueData = {
  weekStart: string; weekEnd: string; tier: number; name: string; selfRank: number;
  rows: LeagueRow[];
  previousResult: { weekStart: string; tier: number; rank: number; participants: number; xp: number; movement: number } | null;
};

function LeagueAvatar({ type }: { type: string }) {
  const Glyph = type === 'sun' ? Sun : type === 'flower' ? Flower2 : type === 'mountain' ? Mountain : Leaf;
  return <Glyph size={17} strokeWidth={2.2}/>;
}

function useLeagueData() {
  const { user, online, state } = useStore();
  const [league, setLeague] = useState<LeagueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cacheKey = user ? `talkora.league.v1.${user.id}` : '';

  const refresh = useCallback(async () => {
    if (!user || !navigator.onLine) return;
    setLoading(true);
    setError('');
    try {
      const result: LeagueData = await api('/league');
      setLeague(result);
      try { localStorage.setItem(`talkora.league.v1.${user.id}`, JSON.stringify(result)); } catch { /* Optional offline preview. */ }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Не удалось загрузить лигу.');
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!user) { setLeague(null); return; }
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached?.rows && cached?.weekStart) setLeague(cached);
    } catch { /* Damaged cache cannot block the league. */ }
    if (online) void refresh();
  }, [cacheKey, online, refresh, state.progress.xp, user]);

  return { user, online, league, loading, error, refresh };
}

export function LeagueProfileCard() {
  const { user, league, loading } = useLeagueData();
  if (!user) return null;
  return <section className="profile-league-summary"><span className="quick-icon mint"><Trophy size={24}/></span><div><span className="eyebrow">ТВОЯ НЕДЕЛЬНАЯ ЛИГА</span><h2>{league?.name || 'Собираем группу'}</h2><p>{league ? `${league.selfRank}-е место из ${league.rows.length} · ${league.rows.find(row => row.self)?.xp ?? 0} очков за неделю` : loading ? 'Загружаем результаты…' : 'Подключись к интернету, чтобы увидеть место.'}</p></div></section>;
}

export function LeagueScreen() {
  const { user, online, league, loading, error, refresh } = useLeagueData();

  if (!user) return <Empty icon={<Trophy size={36}/>} title="Твоя лига ждёт" text="Войди в Talkora, чтобы увидеть свою небольшую группу и результаты недели."/>;
  const weekEnd = league ? new Date(league.weekEnd).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
  const prior = league?.previousResult;

  return <>
    <SectionTitle eyebrow="ВМЕСТЕ ИНТЕРЕСНЕЕ" title="Маленькая лига. Большая мотивация." text="У каждого свой темп. Здесь видны результаты текущей недели."/>
    <div className="league-layout">
      <section className="league-board">
        <div className="league-header"><span className="large-trophy"><Trophy size={54}/></span><div><span className="eyebrow">НЕДЕЛЬНАЯ ЛИГА</span><h2>{league?.name || 'Твоя лига'}</h2><p>{league ? `Итоги недели — ${weekEnd}` : 'Загружаем участников'}</p></div></div>
        <div className="preview-notice"><CircleHelp size={18}/><span>{online ? 'Сервер проверяет первые ответы в основном пути, мини-тестах и онлайн-тренировках «Мои слова». Только проверенные очки входят в недельную таблицу.' : 'Ты офлайн. Показана последняя сохранённая таблица; локальные результаты появятся в общем прогрессе, но без серверной сессии не попадут в лигу.'}</span></div>
        {prior && <p className="league-prior">Прошлая неделя: {prior.rank}-е место из {prior.participants}, {prior.xp} очков. {prior.movement > 0 ? 'Следующая ступень открыта!' : prior.movement < 0 ? 'В этот раз ступень ниже.' : 'Ступень сохранена.'}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="ranking-head"><span>МЕСТО</span><span>УЧАСТНИК</span><span>ОЧКИ ЗА НЕДЕЛЮ</span></div>
        {league?.rows.map((row) => <div className={'ranking-row '+(row.self?'you':'')} key={row.nickname}><b>{row.rank}</b><span className="ranking-avatar mint" aria-label={'Аватар '+row.nickname}><LeagueAvatar type={row.avatar}/></span><strong>{row.nickname}{row.self && <small>это ты</small>}</strong><span>{row.xp}<Gem size={15}/></span></div>)}
        {!league && <p className="league-prior">{loading ? 'Собираем твою группу…' : 'Подключись к интернету, чтобы открыть лигу.'}</p>}
        <button className="text-button league-refresh" disabled={loading || !online} onClick={() => void refresh()}><RotateCcw size={17}/>{loading ? 'Обновляем…' : 'Обновить таблицу'}</button>
      </section>
      <aside className="league-rules"><span className="quick-icon mint"><Leaf size={27}/></span><h2>Свой темп.<br/>Своя команда.</h2><p>Каждую неделю — группа до 12 участников со схожей активностью в прошлую неделю.</p><ol><li><span>01</span><div><strong>Проходи основной путь</strong><p>Проверенные уроки и мини-тесты приносят очки лиги.</p></div></li><li><span>02</span><div><strong>Повторяй свои слова</strong><p>Онлайн-тренировки личных слов тоже входят в рейтинг после проверки сервером.</p></div></li><li><span>03</span><div><strong>Открывай новую лигу</strong><p>В группах от трёх человек место определяет следующую ступень.</p></div></li></ol><p className="fine-print">Личные слова, почта и учебные материалы не показываются другим участникам. Темы и офлайн-тренировки дают общий XP без очков лиги.</p></aside>
    </div>
  </>;
}
