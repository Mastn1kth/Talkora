async page => {
  const base='http://127.0.0.1:3010';
  await page.goto(base+'/');
  await page.evaluate(async()=>{for(const registration of await navigator.serviceWorker.getRegistrations())await registration.unregister();for(const key of await caches.keys())await caches.delete(key);});
  await page.reload();
  await page.evaluate(async()=>{
    let response=await fetch('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'verified@example.test',nickname:'VerifiedLearner',password:'TestPassword123!'})});
    let data=await response.json();
    if(!response.ok){response=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'verified@example.test',password:'TestPassword123!'})});data=await response.json();}
    data.state.profile.onboarded=true;
    response=await fetch('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({userId:data.user.id,state:data.state,version:data.version})});
    if(!response.ok)throw new Error(await response.text());
  });
  await page.reload();
  await page.getByRole('button',{name:/Давай знакомиться — начать/}).click();
  await page.getByRole('button',{name:/Начать урок/}).click();
  const answers=[
    async()=>page.locator('.answer-options button').filter({hasText:'привет'}).click(),
    async()=>page.locator('.answer-input').fill('hello'),
    async()=>{await page.locator('.word-tiles button').filter({hasText:'Hello,'}).click();await page.locator('.word-tiles button').filter({hasText:'Anna!'}).click();},
    async()=>page.locator('.answer-input').fill('hello'),
    async()=>page.locator('.answer-options button').filter({hasText:'имя'}).click(),
    async()=>page.locator('.answer-input').fill('name'),
  ];
  for(const answer of answers){await answer();await page.getByRole('button',{name:'Проверить',exact:true}).click();await page.getByRole('button',{name:'Продолжить',exact:true}).click();}
  const result=await page.locator('.lesson-result').innerText();
  await page.getByRole('button',{name:'Продолжить путешествие'}).click();
  await page.waitForFunction(()=>document.querySelector('.topbar-status')?.getAttribute('title')==='Синхронизировано',null,{timeout:15000});
  return await page.evaluate(async result=>{
    const state=await (await fetch('/api/state')).json();
    const league=await (await fetch('/api/league')).json();
    const event=state.state.history.at(-1);
    return {result,xp:state.state.progress.xp,completed:state.state.progress.completedLessons,event:{xp:event.xp,accuracy:event.accuracy,proof:event.proof},leagueXp:league.rows.find(row=>row.self)?.xp};
  },result);
}
