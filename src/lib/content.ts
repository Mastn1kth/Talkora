export interface Exercise {
  id: string;
  type: 'choice' | 'build' | 'input' | 'listen';
  prompt: string;
  answer: string;
  options?: string[];
  translation?: string;
  hint: string;
  explanation: string;
  audio?: string;
  word?: string;
}
export interface Lesson { id: string; title: string; description: string; arenaId: string; exercises: Exercise[] }
export interface Arena { id: string; title: string; subtitle: string; level: string; color: string; lessons: Lesson[]; requiredXp: number }
export interface DictionaryWord {
  id: string; english: string; russian: string; transcription: string; partOfSpeech: string;
  example: string; exampleRu: string; usVariant?: string; grammarId?: string;
}
export interface GrammarArticle {
  id: string; title: string; category: string; level: string; summary: string;
  explanation: string; examples: { en: string; ru: string }[]; rule: string;
}

// This is a deliberately finite seed library, not a complete CEFR curriculum.
const wordRows: [string, string, string, string, string, string, string?][] = [
  ['hello', 'привет', 'həˈləʊ', 'междометие', 'Hello, Anna!', 'Привет, Анна!'],
  ['name', 'имя', 'neɪm', 'существительное', 'My name is Alex.', 'Меня зовут Алекс.'],
  ['friend', 'друг', 'frend', 'существительное', 'You are my friend.', 'Ты мой друг.'],
  ['family', 'семья', 'ˈfæməli', 'существительное', 'I love my family.', 'Я люблю свою семью.'],
  ['mother', 'мама', 'ˈmʌðə', 'существительное', 'My mother is at home.', 'Моя мама дома.'],
  ['brother', 'брат', 'ˈbrʌðə', 'существительное', 'I have a brother.', 'У меня есть брат.'],
  ['one', 'один', 'wʌn', 'числительное', 'I have one apple.', 'У меня одно яблоко.'],
  ['two', 'два', 'tuː', 'числительное', 'I have two books.', 'У меня две книги.'],
  ['three', 'три', 'θriː', 'числительное', 'I have three pencils.', 'У меня три карандаша.'],
  ['house', 'дом', 'haʊs', 'существительное', 'This house is small.', 'Этот дом маленький.'],
  ['room', 'комната', 'ruːm', 'существительное', 'My room is bright.', 'Моя комната светлая.'],
  ['flat', 'квартира', 'flæt', 'существительное', 'We live in a flat.', 'Мы живём в квартире.', 'apartment'],
  ['water', 'вода', 'ˈwɔːtə', 'существительное', 'I would like some water.', 'Я хотел бы немного воды.'],
  ['bread', 'хлеб', 'bred', 'существительное', 'This bread is fresh.', 'Этот хлеб свежий.'],
  ['apple', 'яблоко', 'ˈæpəl', 'существительное', 'The apple is green.', 'Яблоко зелёное.'],
  ['shop', 'магазин', 'ʃɒp', 'существительное', 'The shop is open.', 'Магазин открыт.', 'store'],
  ['price', 'цена', 'praɪs', 'существительное', 'The price is on the box.', 'Цена указана на коробке.'],
  ['bag', 'сумка', 'bæɡ', 'существительное', 'This is my bag.', 'Это моя сумка.'],
  ['bus', 'автобус', 'bʌs', 'существительное', 'The bus is late.', 'Автобус опаздывает.'],
  ['train', 'поезд', 'treɪn', 'существительное', 'The train is at the station.', 'Поезд на станции.'],
  ['ticket', 'билет', 'ˈtɪkɪt', 'существительное', 'I need a ticket.', 'Мне нужен билет.'],
  ['airport', 'аэропорт', 'ˈeəpɔːt', 'существительное', 'We are at the airport.', 'Мы в аэропорту.'],
  ['passport', 'паспорт', 'ˈpɑːspɔːt', 'существительное', 'Here is my passport.', 'Вот мой паспорт.'],
  ['luggage', 'багаж', 'ˈlʌɡɪdʒ', 'существительное', 'My luggage is heavy.', 'Мой багаж тяжёлый.'],
  ['boarding pass', 'посадочный талон', 'ˈbɔːdɪŋ pɑːs', 'словосочетание', 'Here is my boarding pass.', 'Вот мой посадочный талон.'],
  ['gate', 'выход на посадку', 'ɡeɪt', 'существительное', 'Our gate is number five.', 'Наш выход на посадку — номер пять.'],
  ['flight', 'рейс', 'flaɪt', 'существительное', 'Our flight is on time.', 'Наш рейс отправляется вовремя.'],
  ['hotel', 'отель', 'həʊˈtel', 'существительное', 'The hotel is near the station.', 'Отель рядом со станцией.'],
  ['reservation', 'бронирование', 'ˌrezəˈveɪʃən', 'существительное', 'I have a reservation.', 'У меня есть бронирование.'],
  ['key', 'ключ', 'kiː', 'существительное', 'Here is your key.', 'Вот ваш ключ.'],
  ['breakfast', 'завтрак', 'ˈbrekfəst', 'существительное', 'Breakfast is at eight.', 'Завтрак в восемь.'],
  ['yesterday', 'вчера', 'ˈjestədeɪ', 'наречие', 'I worked yesterday.', 'Я работал вчера.'],
  ['visited', 'посетил', 'ˈvɪzɪtɪd', 'глагол, Past Simple', 'We visited London.', 'Мы посетили Лондон.'],
  ['went', 'пошёл', 'went', 'глагол, Past Simple', 'He went to school.', 'Он пошёл в школу.'],
  ['tomorrow', 'завтра', 'təˈmɒrəʊ', 'наречие', 'I will call tomorrow.', 'Я позвоню завтра.'],
  ['interview', 'собеседование', 'ˈɪntəvjuː', 'существительное', 'My interview is on Monday.', 'Моё собеседование в понедельник.'],
  ['experience', 'опыт', 'ɪkˈspɪəriəns', 'существительное', 'I have teaching experience.', 'У меня есть опыт преподавания.'],
  ['team', 'команда', 'tiːm', 'существительное', 'I work in a team.', 'Я работаю в команде.'],
  ['skill', 'навык', 'skɪl', 'существительное', 'Listening is an important skill.', 'Умение слушать — важный навык.'],
  ['school', 'школа', 'skuːl', 'существительное', 'My school is near the park.', 'Моя школа рядом с парком.'],
  ['book', 'книга', 'bʊk', 'существительное', 'This book is interesting.', 'Эта книга интересная.'],
  ['teacher', 'учитель', 'ˈtiːtʃə', 'существительное', 'Our teacher is kind.', 'Наш учитель добрый.'],
  ['say', 'сказать', 'seɪ', 'глагол', 'Please say it again.', 'Пожалуйста, скажите это ещё раз.'],
  ['tell', 'рассказать', 'tel', 'глагол', 'Tell me a story.', 'Расскажи мне историю.'],
  ['message', 'сообщение', 'ˈmesɪdʒ', 'существительное', 'I have a message for you.', 'У меня для тебя сообщение.'],
  ['code', 'код', 'kəʊd', 'существительное', 'This code works.', 'Этот код работает.'],
  ['bug', 'ошибка в программе', 'bʌɡ', 'существительное', 'There is a bug in the app.', 'В приложении есть ошибка.'],
  ['file', 'файл', 'faɪl', 'существительное', 'Please open the file.', 'Пожалуйста, откройте файл.'],
  ['save', 'сохранить', 'seɪv', 'глагол', 'Please save your work.', 'Пожалуйста, сохраните свою работу.'],
  ['colour', 'цвет', 'ˈkʌlə', 'существительное', 'Blue is my favourite colour.', 'Синий — мой любимый цвет.', 'color'],
  ['favourite', 'любимый', 'ˈfeɪvərɪt', 'прилагательное', 'This is my favourite song.', 'Это моя любимая песня.', 'favorite'],
  ['usually', 'обычно', 'ˈjuːʒuəli', 'наречие', 'I usually walk to school.', 'Я обычно хожу в школу пешком.'],
  ['morning', 'утро', 'ˈmɔːnɪŋ', 'существительное', 'I read in the morning.', 'Я читаю утром.'],
  ['park', 'парк', 'pɑːk', 'существительное', 'We play in the park.', 'Мы играем в парке.'],
];

export const dictionary: DictionaryWord[] = wordRows.map(([english, russian, transcription, partOfSpeech, example, exampleRu, usVariant]) => ({
  id: english.replace(/\s+/g, '-'), english, russian, transcription: `/${transcription}/`, partOfSpeech, example, exampleRu,
  ...(usVariant ? { usVariant } : {}),
  grammarId: ['went', 'visited', 'yesterday'].includes(english) ? 'past-simple' : ['say', 'tell'].includes(english) ? 'say-tell' : 'word-order',
}));

export const grammarArticles: GrammarArticle[] = [
  { id: 'to-be', title: 'Знакомство с to be', category: 'Первые шаги', level: 'A1', summary: 'Как сказать, кто ты и где находишься.',
    explanation: 'В английском предложении обычно нужен глагол. Там, где по-русски мы говорим «Я дома», по-английски говорим I am at home. После I используем am, после he, she, it — is, после you, we, they — are.', rule: 'I am · he / she / it is · you / we / they are',
    examples: [{ en: 'I am a student.', ru: 'Я студент.' }, { en: 'They are at home.', ru: 'Они дома.' }, { en: 'She is my friend.', ru: 'Она моя подруга.' }] },
  { id: 'present-simple', title: 'Present Simple', category: 'Времена', level: 'A1', summary: 'Привычки, регулярные действия и факты.',
    explanation: 'Используйте Present Simple, когда говорите о привычках или фактах. С I, you, we, they берите начальную форму глагола. С he, she, it обычно добавляйте -s. В вопросах и отрицаниях появляются do или does; после does основной глагол снова без -s.', rule: 'I work. · She works. · Does she work? · She does not work.',
    examples: [{ en: 'I read every day.', ru: 'Я читаю каждый день.' }, { en: 'He plays football.', ru: 'Он играет в футбол.' }, { en: 'Do you like tea?', ru: 'Тебе нравится чай?' }] },
  { id: 'present-continuous', title: 'Present Continuous', category: 'Времена', level: 'A1', summary: 'Действие происходит прямо сейчас.',
    explanation: 'Чтобы сказать, что действие происходит сейчас, соедините am, is или are с глаголом на -ing. Не теряйте to be: I reading неверно, I am reading верно. В вопросе am, is или are ставится перед подлежащим.', rule: 'am / is / are + глагол-ing',
    examples: [{ en: 'I am reading now.', ru: 'Я сейчас читаю.' }, { en: 'They are playing.', ru: 'Они играют.' }, { en: 'Are you listening?', ru: 'Ты слушаешь?' }] },
  { id: 'past-simple', title: 'Past Simple', category: 'Времена', level: 'A2', summary: 'Завершённые действия в прошлом.',
    explanation: 'Past Simple описывает законченное действие в прошлом. У правильных глаголов добавляется -ed: work → worked. Формы неправильных глаголов нужно запомнить: go → went. Для вопросов и отрицаний используется did, после него нужна начальная форма: did not go, а не did not went. У to be свои формы: was и were.', rule: 'I worked / went. · Did you go? · I did not go.',
    examples: [{ en: 'We visited London last year.', ru: 'В прошлом году мы посетили Лондон.' }, { en: 'Did you see Anna?', ru: 'Ты видел Анну?' }, { en: 'I did not work yesterday.', ru: 'Я не работал вчера.' }] },
  { id: 'articles', title: 'Артикли a, an и the', category: 'Строим фразы', level: 'A1', summary: 'Один из многих или уже знакомый предмет.',
    explanation: 'A и an используются с исчисляемым существительным в единственном числе, когда говорим об одном из многих предметов. An выбирают перед гласным звуком, a — перед согласным. The указывает на конкретный предмет, понятный из ситуации или уже упомянутый. Перед множественным числом и неисчисляемыми словами a/an не ставятся.', rule: 'a book · an apple · the book on the table',
    examples: [{ en: 'I have a book. The book is interesting.', ru: 'У меня есть книга. Эта книга интересная.' }, { en: 'This is an apple.', ru: 'Это яблоко.' }, { en: 'I drink water.', ru: 'Я пью воду.' }] },
  { id: 'word-order', title: 'Порядок слов', category: 'Строим фразы', level: 'A1', summary: 'Кто → что делает → что или кого.',
    explanation: 'В обычном утвердительном предложении сначала называют того, кто действует, затем ставят глагол, затем дополнение. Время и место часто добавляют в конце. Вопросы строятся по отдельным правилам: например, Do you like music?', rule: 'Подлежащее + сказуемое + дополнение',
    examples: [{ en: 'I like music.', ru: 'Мне нравится музыка.' }, { en: 'She reads a book.', ru: 'Она читает книгу.' }, { en: 'We play football in the park.', ru: 'Мы играем в футбол в парке.' }] },
  { id: 'prepositions', title: 'In, on и at', category: 'Строим фразы', level: 'A1', summary: 'Говорим о месте и времени.',
    explanation: 'Для места in часто означает «внутри», on — «на поверхности», at — точку или место деятельности. Для времени: in the morning и in July, on Monday и on 5 May, at eight и at night. Эти сочетания лучше учить с примерами.', rule: 'in a room · on a table · at school; in July · on Monday · at eight',
    examples: [{ en: 'The key is on the table.', ru: 'Ключ на столе.' }, { en: 'I am at school.', ru: 'Я в школе.' }, { en: 'Breakfast is at eight.', ru: 'Завтрак в восемь.' }] },
  { id: 'pronouns', title: 'Личные местоимения', category: 'Первые шаги', level: 'A1', summary: 'I, you, he, she, it, we, they.',
    explanation: 'Местоимения заменяют имена и названия. I — я, you — ты или вы, he — он, she — она, it — оно (о предмете или животном, если пол не важен), we — мы, they — они. I всегда пишется с большой буквы. После предлога или глагола часто нужна другая форма: me, him, her, us, them.', rule: 'I → me · he → him · she → her · we → us · they → them',
    examples: [{ en: 'She is my friend.', ru: 'Она моя подруга.' }, { en: 'I can see her.', ru: 'Я её вижу.' }, { en: 'They live here.', ru: 'Они живут здесь.' }] },
  { id: 'can', title: 'Модальный глагол can', category: 'Строим фразы', level: 'A1', summary: 'Умения, возможности и простые просьбы.',
    explanation: 'Can означает «могу» или «умею». После него ставится начальная форма глагола без to. Can одинаков для всех лиц: she can, а не she cans. В вопросе can ставят перед подлежащим. Отрицание — cannot или can’t.', rule: 'I can swim. · Can you help? · I cannot swim.',
    examples: [{ en: 'She can speak English.', ru: 'Она умеет говорить по-английски.' }, { en: 'Can you help me?', ru: 'Можете мне помочь?' }, { en: 'I cannot open the file.', ru: 'Я не могу открыть файл.' }] },
  { id: 'future', title: 'Планы: going to', category: 'Времена', level: 'A2', summary: 'Как рассказать о намерении.',
    explanation: 'Am/is/are going to + глагол помогает рассказать о намерении или плане. Не забывайте форму to be. Going to также используют для предсказаний по видимым признакам. Will часто нужен для решения в момент речи или обещания. Это стартовое объяснение; способы говорить о будущем зависят от контекста.', rule: 'am / is / are + going to + начальная форма глагола',
    examples: [{ en: 'I am going to visit London.', ru: 'Я собираюсь посетить Лондон.' }, { en: 'We are going to study together.', ru: 'Мы собираемся заниматься вместе.' }, { en: 'I will help you.', ru: 'Я тебе помогу.' }] },
  { id: 'say-tell', title: 'Say и tell', category: 'Похожие слова', level: 'A2', summary: 'Сказать что-то или рассказать кому-то.',
    explanation: 'Say обычно фокусируется на словах: say hello, say something. Адресат с say вводится через to: say hello to Anna. Tell часто требует адресата без to: tell me, tell Anna. Запомните отдельные сочетания: tell a story, tell the truth. В прошедшем времени: said и told.', rule: 'say something (to someone) · tell someone something · tell a story',
    examples: [{ en: 'Say hello to Anna.', ru: 'Передай привет Анне.' }, { en: 'Tell me your name.', ru: 'Скажи мне, как тебя зовут.' }, { en: 'She told us a story.', ru: 'Она рассказала нам историю.' }] },
];

function word(english: string): DictionaryWord {
  const entry = dictionary.find(item => item.english === english);
  if (!entry) throw new Error(`Missing curriculum word: ${english}`);
  return entry;
}

function choices(answer: string, alternatives: string[], seed = 0): string[] {
  const values = [answer, ...alternatives.filter(value => value !== answer)].filter((value, index, all) => all.indexOf(value) === index).slice(0, 4);
  const shift = seed % values.length;
  return [...values.slice(shift), ...values.slice(0, shift)];
}

function vocabularyExercises(prefix: string, entries: DictionaryWord[]): Exercise[] {
  const result: Exercise[] = [];
  entries.forEach((entry, index) => {
    const distractors = dictionary.filter(candidate => candidate.russian !== entry.russian && candidate.english !== entry.english).slice(index + 5, index + 8);
    result.push({ id: `${prefix}-${index}-meaning`, type: 'choice', prompt: `Выберите перевод: ${entry.english}`, answer: entry.russian,
      options: choices(entry.russian, distractors.map(item => item.russian), index + 1), word: entry.english,
      hint: `Пример: ${entry.example}`, explanation: `${entry.english} — ${entry.russian}. ${entry.example} — ${entry.exampleRu}`, translation: entry.exampleRu });
    result.push({ id: `${prefix}-${index}-listen`, type: 'listen', prompt: 'Послушайте и напишите английское слово или выражение.', answer: entry.english,
      audio: entry.english, word: entry.english, hint: `Перевод: ${entry.russian}`, explanation: `Вы услышали «${entry.english}» — ${entry.russian}.`, translation: entry.russian });
    result.push({ id: `${prefix}-${index}-build`, type: 'build', prompt: `Соберите предложение: «${entry.exampleRu}»`, answer: entry.example,
      options: entry.example.split(/\s+/).reverse(), word: entry.english, hint: `Начните с «${entry.example.split(' ')[0]}».`, explanation: `${entry.example} — ${entry.exampleRu}`, translation: entry.exampleRu });
    result.push({ id: `${prefix}-${index}-write`, type: 'input', prompt: `Напишите слово или выражение из урока: «${entry.russian}»`, answer: entry.english,
      word: entry.english, hint: `Начинается с «${entry.english[0]}».`, explanation: `${entry.english} — ${entry.russian}. Пример: ${entry.example}`, translation: entry.russian });
  });
  return result;
}

function lesson(arenaId: string, id: string, title: string, description: string, words: string[]): Lesson {
  return { id, title, description, arenaId, exercises: vocabularyExercises(id, words.map(word)) };
}

export const arenas: Arena[] = [
  { id: 'first-steps', title: 'Первые слова', subtitle: 'Каждое путешествие начинается с hello', level: 'A1', color: '#7c6cf0', requiredXp: 0,
    lessons: [lesson('first-steps', 'hello', 'Давай знакомиться', 'Приветствие, имя и первые простые фразы.', ['hello', 'name', 'friend']),
      lesson('first-steps', 'family', 'Мои близкие', 'Расскажем о семье и потренируем have.', ['family', 'mother', 'brother']),
      lesson('first-steps', 'numbers', 'Раз, два, три', 'Числа и первые фразы с предметами.', ['one', 'two', 'three'])] },
  { id: 'everyday', title: 'Мой маленький мир', subtitle: 'Дом, любимая еда и большие открытия', level: 'A1', color: '#edaa43', requiredXp: 160,
    lessons: [lesson('everyday', 'home', 'Дом, милый дом', 'Комнаты, квартира и описания вокруг нас.', ['house', 'room', 'flat']),
      lesson('everyday', 'food', 'Что на завтрак?', 'Еда, вода и вежливая просьба.', ['water', 'bread', 'apple']),
      lesson('everyday', 'shopping', 'За покупками', 'Спросим о цене и соберём сумку.', ['shop', 'price', 'bag'])] },
  { id: 'city', title: 'Город открытий', subtitle: 'Твой английский выходит за порог', level: 'A1', color: '#54b5a0', requiredXp: 340,
    lessons: [lesson('city', 'transport', 'Поехали!', 'Поезд, автобус и билет в новое место.', ['bus', 'train', 'ticket']),
      lesson('city', 'school', 'Учимся вместе', 'Книги, школа и знакомство с учителем.', ['school', 'book', 'teacher']),
      lesson('city', 'routine', 'Мой день', 'Регулярные действия и знакомые места.', ['usually', 'morning', 'park'])] },
  { id: 'journeys', title: 'Мир становится ближе', subtitle: 'Первые самостоятельные путешествия', level: 'A2', color: '#649bd8', requiredXp: 540,
    lessons: [lesson('journeys', 'airport', 'В аэропорту', 'Паспорт, багаж и важные слова перед полётом.', ['airport', 'passport', 'luggage']),
      lesson('journeys', 'hotel', 'Добро пожаловать', 'Бронирование отеля и ключ от номера.', ['hotel', 'reservation', 'key']),
      lesson('journeys', 'past', 'Вчера и сегодня', 'Познакомимся с фразами в прошедшем времени.', ['yesterday', 'visited', 'went'])] },
];

const pastExercises: Exercise[] = [
  { id: 'past-rule', type: 'choice', prompt: 'Past Simple: законченное действие в прошлом. Выберите форму go для «вчера».', answer: 'went', options: ['goes', 'going', 'went', 'go'], hint: 'Go — неправильный глагол.', explanation: 'Go → went. В утвердительном предложении о прошлом используем went: I went home yesterday.' },
  { id: 'past-ed', type: 'input', prompt: 'Вставьте work в Past Simple: I ___ yesterday.', answer: 'worked', hint: 'Это правильный глагол: добавьте -ed.', explanation: 'Work → worked. I worked yesterday — Я работал вчера.' },
  { id: 'past-build', type: 'build', prompt: 'Соберите: «Мы посетили Лондон в прошлом году».', answer: 'We visited London last year.', options: ['last', 'visited', 'year.', 'We', 'London'], hint: 'Сначала кто, затем действие, место и время.', explanation: 'We visited London last year. Visited — правильная форма прошедшего времени.' },
  { id: 'past-negative', type: 'choice', prompt: 'Выберите правильное отрицание.', answer: 'I did not go.', options: ['I did not went.', 'I do not went.', 'I did not go.', 'I not went.'], hint: 'После did нужна начальная форма глагола.', explanation: 'В did уже есть прошедшее время, поэтому go остаётся в начальной форме.' },
  { id: 'past-listen', type: 'listen', prompt: 'Послушайте и напишите предложение.', answer: 'We visited London.', audio: 'We visited London.', hint: 'Мы посетили Лондон.', explanation: 'We visited London. У visited окончание -ed произносится /ɪd/.' },
  { id: 'past-question', type: 'input', prompt: 'Вставьте вспомогательный глагол: ___ you work yesterday?', answer: 'Did', hint: 'Вопрос в Past Simple начинается с did.', explanation: 'Did you work yesterday? — Ты работал вчера? После did используйте work.' },
  { id: 'past-was', type: 'choice', prompt: 'I ___ at home yesterday.', answer: 'was', options: ['am', 'are', 'was', 'be'], hint: 'Прошедшая форма am — was.', explanation: 'I was at home yesterday — Я вчера был дома. У to be в прошлом формы was и were.' },
  { id: 'past-build-negative', type: 'build', prompt: 'Соберите: «Мы не работали вчера».', answer: 'We did not work yesterday.', options: ['work', 'We', 'yesterday.', 'not', 'did'], hint: 'После We используйте did not.', explanation: 'We did not work yesterday. В отрицании не добавляем -ed к work.' },
];

const sayTellExercises: Exercise[] = [
  { id: 'say-hello', type: 'choice', prompt: '___ hello to Anna.', answer: 'Say', options: ['Tell', 'Say', 'Told', 'Said'], hint: 'С приветствием hello используем say.', explanation: 'Say hello to Anna — Передай привет Анне. Адресат после say вводится через to.' },
  { id: 'tell-me', type: 'input', prompt: 'Выберите say или tell: Please ___ me your name.', answer: 'tell', hint: 'Здесь сразу после пропуска стоит адресат — me.', explanation: 'Tell me your name. После tell адресат идёт без to.' },
  { id: 'tell-build', type: 'build', prompt: 'Соберите: «Расскажи мне историю».', answer: 'Tell me a story.', options: ['a', 'me', 'story.', 'Tell'], hint: 'Устойчивое сочетание — tell a story.', explanation: 'Tell me a story. Это сочетание с tell: рассказывать историю.' },
  { id: 'say-listen', type: 'listen', prompt: 'Послушайте и напишите фразу.', answer: 'Please say it again.', audio: 'Please say it again.', hint: 'Пожалуйста, скажите это ещё раз.', explanation: 'Please say it again. Say фокусируется на произнесённых словах.' },
  { id: 'say-past', type: 'choice', prompt: 'She ___ us a story yesterday.', answer: 'told', options: ['said', 'say', 'told', 'tell'], hint: 'Tell + us; нужна прошедшая форма.', explanation: 'She told us a story yesterday. Tell → told, адресат us идёт без to.' },
  { id: 'say-truth', type: 'input', prompt: 'Выберите say или tell: Always ___ the truth.', answer: 'tell', hint: '«Говорить правду» — устойчивое сочетание с tell.', explanation: 'Tell the truth — говорить правду. Это сочетание учим целиком.' },
];

export interface TopicTraining { title: string; description: string; exercises: Exercise[]; words: DictionaryWord[]; source: 'curated' }

export function getTopicTraining(topic: string, profile: { age: string; level: string; goals: string[] }): TopicTraining | null {
  const normalized = topic.toLocaleLowerCase('ru-RU').trim();
  const child = /^(0.?14|child|kids|children|under.?15)$/i.test(profile.age.trim());
  let title: string, selected: string[], exercises: Exercise[] | undefined;
  if (/аэропорт|airport|багаж|boarding/.test(normalized)) { title = 'Английский в аэропорту'; selected = ['airport', 'passport', 'boarding pass', 'luggage', 'gate', 'flight']; }
  else if (/отел|гостиниц|hotel/.test(normalized)) { title = 'Разговор в отеле'; selected = ['hotel', 'reservation', 'key', 'room', 'breakfast']; }
  else if (/собеседован|interview/.test(normalized)) {
    title = child ? 'Рассказываем о себе в школе' : 'Первое собеседование';
    selected = child ? ['name', 'school', 'friend', 'book', 'teacher'] : ['interview', 'experience', 'team', 'skill'];
  } else if (/past\s+simple|прошедш.*врем/.test(normalized)) { title = 'Past Simple: вчера и раньше'; selected = ['yesterday', 'visited', 'went']; exercises = pastExercises; }
  else if (/\bsay\b.*\btell\b|\btell\b.*\bsay\b/.test(normalized)) { title = 'Say или tell?'; selected = ['say', 'tell', 'message']; exercises = sayTellExercises; }
  else if (/программист|программирован|programming|developer/.test(normalized)) { title = child ? 'Первые слова о компьютере' : 'Английский для программиста'; selected = ['code', 'bug', 'file', 'save']; }
  else return null;
  const words = selected.map(word);
  const allExercises = exercises ?? vocabularyExercises(`topic-${words[0].id}`, words);
  const isBeginner = /^(A0|A1|beginner|начинающий)$/i.test(profile.level);
  // A finite beginner/extended selection, not an AI proficiency assessment.
  const chosen = isBeginner && exercises ? allExercises.slice(0, 6) : allExercises;
  return { title, words, exercises: chosen.map(exercise => ({ ...exercise, options: exercise.options ? [...exercise.options] : undefined })), source: 'curated',
    description: `${child ? 'Безопасные повседневные примеры. ' : ''}${isBeginner ? 'Начнём с коротких фраз и понятных подсказок. ' : 'Закрепим лексику, порядок слов и понимание на слух. '}Готовый авторский набор; генерация ИИ пока не подключена.` };
}

export function createWordTraining(words: { id: string; english: string; russian: string }[]): Exercise[] {
  const entries: DictionaryWord[] = words.filter(item => item.english.trim() && item.russian.trim()).map(item => {
    const known = dictionary.find(entry => entry.english.toLocaleLowerCase('en-GB') === item.english.toLocaleLowerCase('en-GB') && entry.russian === item.russian);
    return known ?? { ...item, transcription: '', partOfSpeech: '', example: item.english, exampleRu: item.russian };
  });
  // Unverified imported words remain literal pairs: never invent grammar or example sentences.
  return entries.flatMap((entry, index) => {
    const alternatives = [...entries, ...dictionary].filter(item => item.english !== entry.english && item.russian !== entry.russian);
    const prefix = `personal-${entry.id}-${index}`;
    const explanation = `В вашем списке: ${entry.english} — ${entry.russian}.`;
    const result: Exercise[] = [
      { id: `${prefix}-meaning`, type: 'choice', prompt: `Выберите перевод: ${entry.english}`, answer: entry.russian, options: choices(entry.russian, alternatives.map(item => item.russian), index + 1), hint: `Первая буква перевода: ${entry.russian[0]}.`, explanation, word: entry.english },
      { id: `${prefix}-write`, type: 'input', prompt: `Напишите слово или фразу из вашего списка: «${entry.russian}»`, answer: entry.english, hint: `Начинается с «${entry.english[0]}».`, explanation, word: entry.english },
      { id: `${prefix}-listen`, type: 'listen', prompt: 'Послушайте и напишите слово или фразу.', answer: entry.english, audio: entry.english, hint: `Перевод из вашего списка: ${entry.russian}`, explanation, word: entry.english },
    ];
    if (entry.english.trim().split(/\s+/).length > 1) result.push({ id: `${prefix}-build`, type: 'build', prompt: `Соберите фразу из вашего списка: «${entry.russian}»`, answer: entry.english, options: entry.english.split(/\s+/).reverse(), hint: `Начните с «${entry.english.split(' ')[0]}».`, explanation, word: entry.english });
    else result.push({ id: `${prefix}-reverse`, type: 'choice', prompt: `Выберите английское слово из вашего списка: «${entry.russian}»`, answer: entry.english, options: choices(entry.english, alternatives.map(item => item.english), index + 2), hint: `Первая буква: ${entry.english[0]}.`, explanation, word: entry.english });
    return result;
  });
}
