async page => {
  await page.goto('http://127.0.0.1:3010/');
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
  });
  await page.reload();
  await page.evaluate(async () => {
    let response = await fetch('/api/session');
    let data = await response.json();
    if (!data.user) {
      response = await fetch('/api/auth/register', {method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({email:'ocr@example.test',nickname:'OCRTester',password:'TestPassword123!'})});
      data = await response.json();
    }
    if (!data.user) throw new Error(JSON.stringify(data));
    if (!data.state.profile.onboarded) {
      data.state.profile.onboarded = true;
      response = await fetch('/api/state', {method:'PUT', headers:{'content-type':'application/json'},
        body:JSON.stringify({userId:data.user.id,state:data.state,version:data.version})});
      if (!response.ok) throw new Error(await response.text());
    }
  });
  await page.reload();
  const results = [];
  for (const name of ['word-list.pdf', 'word-list.png', 'word-list-scan.pdf']) {
    await page.goto('http://127.0.0.1:3010/#words');
    await page.getByRole('button', { name: 'Загрузить файл' }).click();
    await page.locator('input[type=file]').setInputFiles('D:/prodect/anguege/tests/fixtures/' + name);
    await page.getByRole('heading', { name: 'Проверь распознанный текст' }).waitFor({ timeout: 120000 });
    const extracted = await page.getByRole('textbox', { name: 'Распознанный текст' }).inputValue();
    await page.getByRole('button', { name: 'Проверить список' }).click();
    await page.getByRole('heading', { name: 'Проверим твой список' }).waitFor();
    const english = await page.locator('input[aria-label^="Английское слово"]').evaluateAll(inputs => inputs.map(input => input.value));
    const russian = await page.locator('input[aria-label^="Перевод"]').evaluateAll(inputs => inputs.map(input => input.value));
    results.push({ name, extracted, english, russian });
    await page.reload();
  }
  return results;
}
