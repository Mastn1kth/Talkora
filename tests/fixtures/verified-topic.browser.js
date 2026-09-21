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
      body: JSON.stringify({ email: 'topic@example.test', nickname: 'TopicLearner', password: 'TestPassword123!' }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    data.state.profile.onboarded = true;
    data.state.profile.age = '0-14';
    data.state.profile.level = 'A1';
    const saved = await fetch('/api/state', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: data.user.id, state: data.state, version: data.version }),
    });
    if (!saved.ok) throw new Error(await saved.text());
  });
  await page.reload();
  await page.goto(base + '/#topics');
  await page.getByRole('button', { name: /Собеседование/ }).click();
  const previewTitle = await page.getByRole('dialog').locator('h2').nth(1).innerText();
  await page.getByRole('button', { name: 'К тренировке' }).click();
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/practice/topic') && response.request().method() === 'POST');
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
  const resultText = await page.locator('.lesson-result').innerText();
  await page.getByRole('button', { name: 'Продолжить путешествие' }).click();
  await page.waitForFunction(() => document.querySelector('.topbar-status')?.getAttribute('title') === 'Синхронизировано', null, { timeout: 15000 });
  return await page.evaluate(async ({ resultText, previewTitle, prepared }) => {
    const state = await (await fetch('/api/state')).json();
    const league = await (await fetch('/api/league')).json();
    const event = state.state.history.at(-1);
    return {
      previewTitle, serverTitle: prepared.title, exerciseCount: prepared.exercises.length,
      resultText, savedWords: state.state.words.map(word => word.english), xp: state.state.progress.xp,
      event: { title: event.title, xp: event.xp, accuracy: event.accuracy, proof: event.proof },
      leagueXp: league.rows.find(row => row.self)?.xp,
    };
  }, { resultText, previewTitle, prepared });
}
