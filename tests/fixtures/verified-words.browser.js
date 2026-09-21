async page => {
  const base = 'http://127.0.0.1:3010';
  await page.goto(base + '/');
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
    localStorage.clear();
  });
  await page.reload();
  await page.evaluate(async () => {
    const response = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'words@example.test', nickname: 'WordLearner', password: 'TestPassword123!' }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    data.state.profile.onboarded = true;
    const saved = await fetch('/api/state', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: data.user.id, state: data.state, version: data.version }),
    });
    if (!saved.ok) throw new Error(await saved.text());
  });
  await page.reload();
  await page.goto(base + '/#words');
  await page.getByRole('button', { name: 'Вставить текст' }).click();
  await page.locator('textarea').fill('boarding pass — посадочный талон\nluggage — багаж\ngate — выход на посадку');
  await page.getByRole('button', { name: 'Распознать список' }).click();
  await page.getByRole('button', { name: /Сохранить 3 слов/ }).click();
  await page.getByRole('button', { name: 'Повторить слова' }).click();
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/practice/words') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Начать урок' }).click();
  const prepared = await (await responsePromise).json();
  for (const exercise of prepared.exercises) {
    if (exercise.type === 'choice') {
      await page.locator('.answer-options button').filter({ hasText: exercise.answer }).click();
    } else if (exercise.type === 'build') {
      for (const word of exercise.answer.split(/\s+/)) await page.locator('.word-tiles button').filter({ hasText: word }).click();
    } else {
      await page.locator('.answer-input').fill(exercise.answer);
    }
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  }
  const result = await page.locator('.lesson-result').innerText();
  await page.getByRole('button', { name: 'Продолжить путешествие' }).click();
  await page.waitForFunction(() => document.querySelector('.topbar-status')?.getAttribute('title') === 'Синхронизировано', null, { timeout: 15000 });
  return await page.evaluate(async resultText => {
    const state = await (await fetch('/api/state')).json();
    const league = await (await fetch('/api/league')).json();
    const event = state.state.history.at(-1);
    return {
      resultText,
      wordCount: state.state.words.length,
      xp: state.state.progress.xp,
      event: { title: event.title, xp: event.xp, accuracy: event.accuracy, proof: event.proof },
      leagueXp: league.rows.find(row => row.self)?.xp,
    };
  }, result);
}
