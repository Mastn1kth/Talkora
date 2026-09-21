import { writeFile } from 'node:fs/promises';
import { arenas } from '../src/lib/content.ts';
import { exercisesForDuration } from '../src/lib/learning.ts';

type ExportedActivity = {
  mode: 'lesson' | 'gate';
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

const target = new URL('../server/course.generated.json', import.meta.url);
await writeFile(target, `${JSON.stringify({ version: 1, activities }, null, 2)}\n`, 'utf8');
