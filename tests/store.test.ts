import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, merge } from '../src/lib/store';
import type { AppState, StudyEvent } from '../src/lib/store';

const user={id:'u1',email:'learner@example.test',nickname:'Learner'};
const event=(id:string,xp:number,coins=5):StudyEvent=>({id,date:'2026-09-20T12:00:00.000Z',title:id,xp,coins});
const snapshot=(base:AppState,state:AppState)=>({user,base,state,version:1,pending:true});

test('concurrent save keeps a local deletion and an unrelated remote lesson',()=>{
  const base=initialState();base.words=[{id:'hello',english:'hello',russian:'привет'}];
  const local=structuredClone(base);local.words=[];local.profile.age='15-24';
  const remote=structuredClone(base);remote.history=[event('lesson-a',30)];remote.progress.xp=30;remote.progress.coins=5;remote.progress.completedLessons=['lesson-a'];remote.profile.goals=['study'];
  const result=merge(snapshot(base,local),remote);
  assert.deepEqual(result.words,[]);
  assert.equal(result.profile.age,'15-24');
  assert.deepEqual(result.profile.goals,['study']);
  assert.equal(result.progress.xp,30);
  assert.deepEqual(result.progress.completedLessons,['lesson-a']);
});

test('an acknowledged event is not awarded twice after a lost response',()=>{
  const base=initialState();
  const local=structuredClone(base);local.history=[event('shared',30),event('local',20)];local.progress.xp=50;local.progress.coins=10;
  const remote=structuredClone(base);remote.history=[event('shared',30),event('other',10)];remote.progress.xp=40;remote.progress.coins=10;
  const result=merge(snapshot(base,local),remote);
  assert.deepEqual(result.history.map(value=>value.id),['shared','other','local']);
  assert.equal(result.progress.xp,60);
  assert.equal(result.progress.coins,15);
});

test('simultaneous first completion of one published lesson turns the later offline result into a repeat',()=>{
  const base=initialState();
  const proof={contentId:'hello',activityId:'hello',responses:[{exerciseId:'hello-0-meaning',answer:'привет'}]};
  const local=structuredClone(base);local.history=[{...event('local-hello',30),title:'Давай знакомиться',proof}];local.progress.xp=30;local.progress.coins=5;local.progress.completedLessons=['hello'];
  const remote=structuredClone(base);remote.history=[{...event('remote-hello',30),title:'Давай знакомиться',proof}];remote.progress.xp=30;remote.progress.coins=5;remote.progress.completedLessons=['hello'];
  const result=merge(snapshot(base,local),remote);
  assert.equal(result.progress.xp,40);
  assert.equal(result.progress.coins,10);
  assert.equal(result.history.find(value=>value.id==='local-hello')?.xp,10);
  assert.deepEqual(result.progress.completedLessons,['hello']);
});

test('remote deletion wins when the local word has not changed',()=>{
  const base=initialState();base.words=[{id:'word',english:'book',russian:'книга'}];
  const local=structuredClone(base);
  const remote=structuredClone(base);remote.words=[];
  assert.deepEqual(merge(snapshot(base,local),remote).words,[]);
});

test('simultaneous recovery on two devices keeps only one recovery for the missed day',()=>{
  const base=initialState();base.progress.streak=6;base.progress.bestStreak=6;base.progress.lastStudyDate='2026-09-18';base.progress.coins=20;
  const recovery=(id:string):StudyEvent=>({id,date:'2026-09-20T12:00:00.000Z',title:'Восстановление серии',xp:0,coins:0,kind:'streak_restore',restoreDate:'2026-09-20'});
  const local=structuredClone(base);local.history=[recovery('local')];local.progress.freeRestoreUsed=true;local.progress.streakRestoredDate='2026-09-20';
  const remote=structuredClone(base);remote.history=[recovery('remote')];remote.progress.freeRestoreUsed=true;remote.progress.streakRestoredDate='2026-09-20';
  const result=merge(snapshot(base,local),remote);
  assert.deepEqual(result.history.map(value=>value.id),['remote']);
  assert.equal(result.progress.coins,20);
  assert.equal(result.progress.freeRestoreUsed,true);
  assert.equal(result.progress.streakRestoredDate,'2026-09-20');
});

test('conflict merge replays local study days against the newer server streak',()=>{
  const base=initialState();base.progress.streak=3;base.progress.bestStreak=3;base.progress.lastStudyDate='2026-09-14';
  const local=structuredClone(base);local.history=[{...event('offline-tuesday',30),date:'2026-09-15T12:00:00.000Z',studyDate:'2026-09-15'}];local.progress.xp=30;local.progress.coins=5;local.progress.streak=4;local.progress.bestStreak=4;local.progress.lastStudyDate='2026-09-15';
  const remote=structuredClone(base);remote.history=[{...event('online-wednesday',30),date:'2026-09-16T12:00:00.000Z',studyDate:'2026-09-16'}];remote.progress.xp=30;remote.progress.coins=5;remote.progress.streak=1;remote.progress.lastStudyDate='2026-09-16';
  const merged=merge(snapshot(base,local),remote);
  assert.equal(merged.progress.xp,60);
  assert.equal(merged.progress.streak,1);
  assert.equal(merged.progress.lastStudyDate,'2026-09-16');
  assert.equal(merged.progress.bestStreak,3);
});
