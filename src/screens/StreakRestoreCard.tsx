import { useState } from 'react';
import { Flame, Gem } from 'lucide-react';
import { today, useStore } from '../lib/store';
import { restorePrice, streakStatus } from '../lib/streak';

export function StreakRestoreCard({ notify }: { notify: (message: string) => void }) {
  const { state, online, restoreStreak } = useStore();
  const [busy, setBusy] = useState(false);
  const day = today();
  const status = streakStatus(state.progress, day);
  if (status !== 'recoverable' && status !== 'restored') return null;
  const price = restorePrice(state.progress, day);
  const enough = price !== null && state.progress.coins >= price;

  async function restore() {
    setBusy(true);
    try {
      const result = await restoreStreak();
      notify(result === 'free' ? 'Серия восстановлена бесплатно. Пройди урок сегодня, чтобы продолжить её.' : `Серия восстановлена за ${price} кристаллов. Пройди урок сегодня.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось восстановить серию.');
    } finally { setBusy(false); }
  }

  return <section className="streak-restore-card"><span className="streak-restore-icon"><Flame size={27}/></span><div><strong>{status === 'restored' ? 'Серия ждёт твоего урока' : 'Один пропущенный день можно вернуть'}</strong><p>{status === 'restored' ? `Твои ${state.progress.streak} дней сохранены. Займись сегодня, чтобы продолжить серию.` : `Ты занимался ${state.progress.streak} дней подряд. Восстанови серию сегодня и пройди урок.`}</p></div>{status === 'recoverable' && <div className="streak-restore-action"><button className="button secondary small" disabled={!online || !enough || busy} onClick={() => void restore()}>{price === 0 ? 'Восстановить бесплатно' : <><Gem size={15}/>Восстановить за {price}</>}</button>{!online && <small>Нужен интернет для списания награды</small>}{online && !enough && <small>Нужно ещё {price! - state.progress.coins} кристаллов</small>}</div>}</section>;
}
