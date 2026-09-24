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
      body: JSON.stringify({ email: 'placement@example.test', nickname: 'PlacementLearner', password: 'TestPassword123!' }),
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
  await page.goto(base + '/#settings');
  await page.getByRole('button', { name: 'Пройти тест' }).click();
  await page.getByRole('button', { name: 'Пройти стартовый тест' }).click();
  for (const answer of ['привет', 'семья', 'дом', 'вода', 'автобус', 'школа', 'аэропорт', 'отель']) {
    await page.locator('.answer-options button').filter({ hasText: answer }).click();
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  }
  const resultText = await page.locator('.lesson-result').innerText();
  await page.getByRole('button', { name: 'К моему маршруту' }).click();
  await page.waitForFunction(() => document.querySelector('.topbar-status')?.getAttribute('title') === 'Синхронизировано', null, { timeout: 15000 });
  return await page.evaluate(async resultText => {
    const payload = await (await fetch('/api/state')).json();
    const event = payload.state.history.at(-1);
    return {
      resultText,
      placementArena: payload.state.progress.placementArena,
      level: payload.state.profile.level,
      event: { title: event.title, xp: event.xp, coins: event.coins, accuracy: event.accuracy, proof: event.proof },
    };
  }, resultText);
}
