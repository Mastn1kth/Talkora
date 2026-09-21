import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { calendarGap, restorePrice, streakAfterLesson } from './streak';

export type PersonalWord = { id:string; english:string; russian:string; known?:boolean; mistakes?:number; nextReview?:string; interval?:number };
export type LessonProof = {contentId?:string;sessionId?:string;activityId:string;responses:{exerciseId:string;answer:string}[]};
export type StudyEvent = { id:string; date:string; title:string; xp:number; coins:number; accuracy?:number; studyDate?:string; kind?:'streak_restore'; restoreDate?:string; proof?:LessonProof };
export type AppState = {
  profile:{age:string;goals:string[];avatar:string;onboarded:boolean;level:string;locale:string;reminderEnabled:boolean;reminderTime:string;reminderDays:number[]};
  progress:{xp:number;coins:number;streak:number;bestStreak?:number;lastStudyDate:string|null;streakRestoredDate?:string|null;completedLessons:string[];passedArenas:string[];dailyBonusDate:string|null;freeRestoreUsed:boolean;placementArena:number};
  words:PersonalWord[];history:StudyEvent[];reports:unknown[];
};
export type User = {id:string;email:string;nickname:string};
type Snapshot = {user:User;state:AppState;version:number;pending:boolean;base:AppState};
const ACTIVE_KEY='talkora.account.v2';
const USER_KEY=(id:string)=>`talkora.account.v2.${id}`;
export const initialState = ():AppState => ({profile:{age:'25+',goals:['travel'],avatar:'leaf',onboarded:false,level:'A1',locale:'ru',reminderEnabled:false,reminderTime:'19:00',reminderDays:[1,2,3,4,5]},progress:{xp:0,coins:0,streak:0,bestStreak:0,lastStudyDate:null,streakRestoredDate:null,completedLessons:[],passedArenas:[],dailyBonusDate:null,freeRestoreUsed:false,placementArena:0},words:[],history:[],reports:[]});
const dateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const today=()=>dateKey(new Date());
const isState=(value:any):value is AppState=>Boolean(value?.profile&&value?.progress&&Array.isArray(value?.words)&&Array.isArray(value?.history));
function readCache():Snapshot|null {try{const id=localStorage.getItem(ACTIVE_KEY);if(!id)return null;const value=JSON.parse(localStorage.getItem(USER_KEY(id))||'null');return value?.user?.id===id&&isState(value.state)&&Number.isSafeInteger(value.version)?{...value,base:isState(value.base)?value.base:value.state,pending:Boolean(value.pending)}:null;}catch{return null;}}
function saveCache(value:Snapshot|null){try{if(value){localStorage.setItem(USER_KEY(value.user.id),JSON.stringify(value));localStorage.setItem(ACTIVE_KEY,value.user.id);}else{const id=localStorage.getItem(ACTIVE_KEY);localStorage.removeItem(ACTIVE_KEY);if(id){localStorage.removeItem(USER_KEY(id));localStorage.removeItem(`talkora.league.v1.${id}`);}}}catch{/* A full device storage must not break the current screen. */}}
const apiBase=((import.meta as ImportMeta & {env?:{VITE_API_URL?:string}}).env?.VITE_API_URL||'').replace(/\/$/,'');
export const nativeApiReady=!Capacitor.isNativePlatform()||/^https:\/\//i.test(apiBase);
export async function api(path:string,options:RequestInit={}){
  if(!nativeApiReady)throw new Error('Сервер Talkora не подключён к этой сборке. Обнови приложение.');
  const response=await fetch(apiBase+'/api'+path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers}});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Не удалось выполнить запрос'),{status:response.status,data});return data;
}

export function merge(snapshot:Snapshot,remote:AppState):AppState {
  const {state:local,base}=snapshot;
  const profile={...remote.profile};
  for(const key of Object.keys(local.profile) as (keyof AppState['profile'])[]){
    if(JSON.stringify(local.profile[key])!==JSON.stringify(base.profile[key]))(profile as any)[key]=local.profile[key];
  }
  const baseWords=new Map(base.words.map(word=>[word.id,word]));
  const localWords=new Map(local.words.map(word=>[word.id,word]));
  const remoteWords=new Map(remote.words.map(word=>[word.id,word]));
  const mergedWords=new Map<string,PersonalWord>();
  for(const [id,word] of remoteWords){
    const prior=baseWords.get(id),changed=localWords.get(id);
    if(prior&&!changed)continue; // An intentional local deletion must survive the conflict.
    mergedWords.set(id,prior&&changed&&JSON.stringify(prior)!==JSON.stringify(changed)?changed:word);
  }
  for(const [id,word] of localWords){
    if(mergedWords.has(id))continue;
    if(baseWords.has(id)&&!remoteWords.has(id)&&JSON.stringify(baseWords.get(id))===JSON.stringify(word))continue; // Remote deletion.
    mergedWords.set(id,word);
  }
  const remoteIds=new Set(remote.history.map(event=>event.id));
  const remoteRestores=new Set(remote.history.filter(event=>event.kind==='streak_restore').map(event=>event.restoreDate));
  const mergedCompleted=new Set(remote.progress.completedLessons);
  const localOnly=local.history.filter(event=>!remoteIds.has(event.id)&&!(event.kind==='streak_restore'&&remoteRestores.has(event.restoreDate)))
    .sort((a,b)=>a.date.localeCompare(b.date)).map(event=>{
      if(!event.proof)return event;
      const repeated=mergedCompleted.has(event.proof.activityId);
      mergedCompleted.add(event.proof.activityId);
      return repeated&&event.xp>10?{...event,xp:10}:event;
    });
  const history=[...remote.history,...localOnly].sort((a,b)=>a.date.localeCompare(b.date));
  const restoredDate=[local.progress.streakRestoredDate,remote.progress.streakRestoredDate].filter(Boolean).sort().at(-1)||null;
  let mergedStreak=remote.progress.streak;
  let mergedLast=remote.progress.lastStudyDate;
  let mergedBest=remote.progress.bestStreak??remote.progress.streak;
  for(const event of [...localOnly].sort((a,b)=>a.date.localeCompare(b.date))){
    if(event.xp<=0)continue;
    const day=event.studyDate||event.date.slice(0,10);
    if(mergedLast&&calendarGap(day,mergedLast)>0)continue;
    mergedStreak=streakAfterLesson({streak:mergedStreak,lastStudyDate:mergedLast,streakRestoredDate:restoredDate,freeRestoreUsed:local.progress.freeRestoreUsed||remote.progress.freeRestoreUsed,coins:remote.progress.coins},day);
    mergedLast=day;
    mergedBest=Math.max(mergedBest,mergedStreak);
  }
  return {...remote,profile,words:[...mergedWords.values()],history,
    progress:{...remote.progress,
      xp:Math.max(0,remote.progress.xp+localOnly.reduce((sum,event)=>sum+event.xp,0)),
      coins:Math.max(0,remote.progress.coins+localOnly.reduce((sum,event)=>sum+event.coins,0)),
      streak:mergedStreak,
      bestStreak:mergedBest,
      streakRestoredDate:restoredDate,
      lastStudyDate:mergedLast,
      completedLessons:[...new Set([...remote.progress.completedLessons,...local.progress.completedLessons])],
      passedArenas:[...new Set([...remote.progress.passedArenas,...local.progress.passedArenas])],
      placementArena:Math.max(local.progress.placementArena,remote.progress.placementArena),
      freeRestoreUsed:local.progress.freeRestoreUsed||remote.progress.freeRestoreUsed,
      dailyBonusDate:[local.progress.dailyBonusDate,remote.progress.dailyBonusDate].filter(Boolean).sort().at(-1)||null
    }};
}
type Store={state:AppState;user:User|null;loading:boolean;online:boolean;syncStatus:string;update:(fn:(s:AppState)=>AppState)=>void;authenticate:(mode:string,values:Record<string,string>)=>Promise<void>;logout:()=>Promise<void>;deleteAccount:(password:string)=>Promise<void>;sync:()=>Promise<void>;addWords:(words:{english:string,russian:string}[])=>void;completeLesson:(id:string,title:string,accuracy:number,xp:number,words?:PersonalWord[],proof?:LessonProof)=>void;bonus:()=>boolean;restoreStreak:()=>Promise<'free'|'paid'>};
const Context=createContext<Store>(null!);
export const useStore=()=>useContext(Context);

export function StoreProvider({children}:{children:ReactNode}){
  const [state,setState]=useState<AppState>(initialState);
  const [user,setUser]=useState<User|null>(null);
  const [loading,setLoading]=useState(true);
  const [online,setOnline]=useState(navigator.onLine);
  const [syncStatus,setSyncStatus]=useState('');
  const current=useRef<Snapshot|null>(null);
  const stateRef=useRef<AppState>(initialState());
  const revision=useRef(0);
  const syncing=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const blocked=useRef(false);

  const setLiveState=(next:AppState)=>{stateRef.current=next;setState(next);};
  const sync=useCallback(async()=>{
    const sent=current.current;
    if(syncing.current||blocked.current||!sent?.pending||!navigator.onLine)return;
    syncing.current=true;
    const rev=revision.current;
    setSyncStatus('Синхронизация…');
    try{
      const session=await api('/session');
      if(!session.user||session.user.id!==sent.user.id){blocked.current=true;setSyncStatus('Войди снова, чтобы сохранить занятия');return;}
      if(current.current?.user.id!==sent.user.id)return;
      const result=await api('/state',{method:'PUT',body:JSON.stringify({userId:sent.user.id,state:sent.state,version:sent.version})});
      if(current.current?.user.id!==sent.user.id)return;
      const next={...current.current,base:sent.state,version:result.version,pending:revision.current!==rev};
      current.current=next;saveCache(next);
      setSyncStatus(next.pending?'Есть новые изменения':'Синхронизировано');
    }catch(error:any){
      if(error.status===409&&error.data?.state&&current.current?.user.id===sent.user.id){
        const nextState=merge(current.current,error.data.state);
        const next={...current.current,state:nextState,base:error.data.state,version:error.data.version,pending:true};
        current.current=next;revision.current++;setLiveState(nextState);saveCache(next);setSyncStatus('Объединяем изменения');
      }else if(error.status===401||error.status===403){blocked.current=true;setSyncStatus('Войди снова, чтобы сохранить занятия');}
      else setSyncStatus('Сохранено на устройстве');
    }finally{
      syncing.current=false;
      if(current.current?.pending&&!blocked.current&&navigator.onLine)timer.current=setTimeout(()=>void sync(),4000);
    }
  },[]);

  useEffect(()=>{
    let live=true;
    const boot=async()=>{
      const saved=readCache();
      try{
        const response=await api('/session');
        if(!live)return;
        if(response.user){
          const same=Boolean(saved&&saved.user.id===response.user.id&&saved.pending);
          const state= same?merge(saved!,response.state):response.state;
          const next:Snapshot={user:response.user,state,base:response.state,version:response.version,pending:same};
          current.current=next;setLiveState(state);setUser(response.user);saveCache(next);setSyncStatus(same?'Есть изменения':'Синхронизировано');
          if(same)void sync();
        }else{
          current.current=null;setLiveState(initialState());setUser(null);
          if(saved?.pending){blocked.current=true;setSyncStatus('Войди снова, чтобы сохранить занятия');}
          else{saveCache(null);setSyncStatus('Обзор приложения');}
        }
      }catch{if(!live)return;if(saved){current.current=saved;setLiveState(saved.state);setUser(saved.user);}setSyncStatus('Сохранено на устройстве');}
      finally{if(live)setLoading(false);}
    };
    void boot();
    const on=()=>{setOnline(true);if(!blocked.current)void sync();};
    const off=()=>{setOnline(false);setSyncStatus('Офлайн · изменения на устройстве');};
    const changed=(event:StorageEvent)=>{if(event.key===ACTIVE_KEY&&current.current&&event.newValue!==current.current.user.id){blocked.current=true;setSyncStatus('Аккаунт изменён в другой вкладке. Обнови страницу.');}};
    window.addEventListener('online',on);window.addEventListener('offline',off);window.addEventListener('storage',changed);
    return()=>{live=false;window.removeEventListener('online',on);window.removeEventListener('offline',off);window.removeEventListener('storage',changed);if(timer.current)clearTimeout(timer.current);};
  },[sync]);

  const update=useCallback((fn:(s:AppState)=>AppState)=>{
    const next=fn(stateRef.current);
    setLiveState(next);
    if(current.current){
      const snapshot={...current.current,state:next,pending:true};
      current.current=snapshot;revision.current++;saveCache(snapshot);
      setSyncStatus(navigator.onLine?'Сохранение…':'Сохранено на устройстве');
      if(timer.current)clearTimeout(timer.current);
      timer.current=setTimeout(()=>void sync(),450);
    }
  },[sync]);

  async function authenticate(mode:string,values:Record<string,string>){
    if(current.current?.pending)throw new Error('Сначала синхронизируй текущие занятия.');
    const unsent=readCache();
    if(unsent?.pending&&(mode!=='login'||unsent.user.email.toLowerCase()!==values.email?.trim().toLowerCase()))throw new Error(`Сначала войди в ${unsent.user.email}, чтобы сохранить офлайн-занятия.`);
    const response=await api('/auth/'+mode,{method:'POST',body:JSON.stringify(values)});
    const saved=readCache();
    const pending=Boolean(saved?.pending&&saved.user.id===response.user.id);
    const state=pending?merge(saved!,response.state):response.state;
    const next:Snapshot={user:response.user,state,base:response.state,version:response.version,pending};
    blocked.current=false;current.current=next;revision.current++;setLiveState(next.state);setUser(response.user);saveCache(next);setSyncStatus(pending?'Есть изменения':'Синхронизировано');
    if(pending)void sync();
  }
  async function logout(){
    await sync();
    const snapshot=current.current;
    if(snapshot?.pending)throw new Error('Дождись синхронизации, чтобы не потерять занятия.');
    await api('/auth/logout',{method:'POST',body:JSON.stringify({userId:snapshot?.user.id})});
    current.current=null;revision.current++;saveCache(null);setLiveState(initialState());setUser(null);setSyncStatus('Обзор приложения');
  }
  async function deleteAccount(password:string){
    const id=current.current?.user.id;
    await api('/account',{method:'DELETE',body:JSON.stringify({userId:id,password})});
    current.current=null;revision.current++;saveCache(null);setLiveState(initialState());setUser(null);setSyncStatus('Обзор приложения');
  }
  function addWords(words:{english:string,russian:string}[]){update(s=>({...s,words:[...s.words,...words.filter(word=>!s.words.some(old=>old.english.toLowerCase()===word.english.toLowerCase())).map(word=>({...word,id:crypto.randomUUID(),known:false,mistakes:0,nextReview:today(),interval:1}))]}));}
  function completeLesson(id:string,title:string,accuracy:number,xp:number,words:PersonalWord[]=[],proof?:LessonProof){
    update(s=>{
      const repeated=s.progress.completedLessons.includes(id);
      const earned=repeated?Math.min(xp,10):xp;
      const streak=streakAfterLesson(s.progress,today());
      const event:StudyEvent={id:crypto.randomUUID(),date:new Date().toISOString(),studyDate:today(),title,xp:earned,coins:5,accuracy,...(proof?{proof}: {})};
      return {...s,progress:{...s.progress,xp:s.progress.xp+earned,coins:s.progress.coins+5,streak,bestStreak:Math.max(s.progress.bestStreak??s.progress.streak,streak),lastStudyDate:today(),completedLessons:[...new Set([...s.progress.completedLessons,id])]},history:[...s.history,event],words:[...s.words,...words.filter(word=>!s.words.some(old=>old.english.toLowerCase()===word.english.toLowerCase()))]};
    });
  }
  function bonus(){
    if(stateRef.current.progress.dailyBonusDate===today())return false;
    update(s=>({...s,progress:{...s.progress,dailyBonusDate:today(),coins:s.progress.coins+10},history:[...s.history,{id:'bonus-'+today(),date:new Date().toISOString(),title:'Ежедневный подарок',xp:0,coins:10}]}));
    return true;
  }
  async function restoreStreak():Promise<'free'|'paid'> {
    if(!current.current?.user)throw new Error('Войди в аккаунт, чтобы восстановить серию.');
    if(!navigator.onLine)throw new Error('Для восстановления серии нужен интернет. Уроки и слова доступны офлайн.');
    if(current.current.pending){await sync();if(current.current?.pending)throw new Error('Дождись синхронизации последних занятий и попробуй снова.');}
    const day=today();
    const cost=restorePrice(stateRef.current.progress,day);
    if(cost===null)throw new Error('Сейчас серия не нуждается в восстановлении.');
    if(stateRef.current.progress.coins<cost)throw new Error(`Для восстановления нужно ${cost} кристаллов.`);
    const account=current.current.user.id;
    const before=revision.current;
    const result=await api('/streak/restore',{method:'POST',body:JSON.stringify({userId:account,day})});
    if(current.current?.user.id!==account)throw new Error('Аккаунт изменился во время восстановления. Обнови страницу.');
    const changed=revision.current!==before;
    const nextState=changed?merge(current.current,result.state):result.state;
    const next:Snapshot={...current.current,state:nextState,base:result.state,version:result.version,pending:changed};
    current.current=next;setLiveState(nextState);saveCache(next);setSyncStatus(changed?'Есть новые изменения':'Синхронизировано');
    if(changed)void sync();
    return result.cost===0?'free':'paid';
  }
  return <Context.Provider value={{state,user,loading,online,syncStatus,update,authenticate,logout,deleteAccount,sync,addWords,completeLesson,bonus,restoreStreak}}>{children}</Context.Provider>;
}
