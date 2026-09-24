import { writeFile } from 'node:fs/promises';
import { arenas, getTopicTraining, placementExercises } from '../src/lib/content.ts';
import { exercisesForDuration } from '../src/lib/learning.ts';

type ExportedActivity = {
  mode: 'lesson' | 'gate' | 'placement';
  title: string;
  arenaId: string;
  answers: Record<string, string>;
  allowedExerciseSets: string[][];
};

const activities: Record<string, ExportedActivity> = {};
for (const arena of arenas) {
  for (const item of arena.lessons) {
    activities[item.id] = {
      mode: 'lesson', title: item.title, arenaId: arena.id,
      answers: Object.fromEntries(item.exercises.map(exercise => [exercise.id, exercise.answer])),
      allowedExerciseSets: [5, 10, 15].map(minutes => exercisesForDuration(item.exercises, minutes).map(exercise => exercise.id)),
    };
  }
  const gate = arena.lessons.flatMap(item => item.exercises.slice(0, 2));
  activities[`gate-${arena.id}`] = {
    mode: 'gate', title: `Мини-тест: ${arena.title}`, arenaId: arena.id,
    answers: Object.fromEntries(gate.map(exercise => [exercise.id, exercise.answer])),
    allowedExerciseSets: [gate.map(exercise => exercise.id)],
  };
}
activities.placement = {
  mode: 'placement', title: 'Твоя отправная точка', arenaId: arenas[0].id,
  answers: Object.fromEntries(placementExercises.map(exercise => [exercise.id, exercise.answer])),
  allowedExerciseSets: [placementExercises.map(exercise => exercise.id)],
};

const topicQueries = {
  airport: 'Английский в аэропорту', hotel: 'Разговор в отеле', interview: 'Собеседование на работу',
  'past-simple': 'Past Simple', 'say-tell': 'Разница между say и tell', programming: 'Английский для программиста',
} as const;
type ExportedTopic = {title:string;description:string;words:{id:string;english:string;russian:string}[];exercises:Record<string,unknown>;allowedExerciseSets:string[][]};
const topics:Record<string,Record<string,ExportedTopic>>={};
for(const [id,query] of Object.entries(topicQueries)){
  topics[id]={};
  for(const [audience,age] of [['child','0-14'],['general','25+']] as const){
    for(const [difficulty,level] of [['beginner','A1'],['extended','B1']] as const){
      const training=getTopicTraining(query,{age,level,goals:[]});
      if(!training)throw new Error(`Missing curated topic: ${id}`);
      topics[id][`${audience}-${difficulty}`]={title:training.title,description:training.description,
        words:training.words.map(({id:wordId,english,russian})=>({id:wordId,english,russian})),
        exercises:Object.fromEntries(training.exercises.map(exercise=>[exercise.id,exercise])),
        allowedExerciseSets:[5,10,15].map(minutes=>exercisesForDuration(training.exercises,minutes).map(exercise=>exercise.id))};
    }
  }
}

const target = new URL('../server/course.generated.json', import.meta.url);
await writeFile(target, `${JSON.stringify({ version: 1, activities, topics }, null, 2)}\n`, 'utf8');
