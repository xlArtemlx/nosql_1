# MongoDB Atlas — Spotify Dataset

## Налаштування оточення і запуск проєкту з нуля

Для виконання потрібні **macOS**, **Python**, **MongoDB Shell (`mongosh`)** та MongoDB Atlas із налаштованим кластером, користувачем БД і дозволеним IP-адресом для підключення. У проєкті використовується безкоштовний кластер Atlas M0. `Node.js` для виконання MongoDB-скриптів не потрібний: JavaScript-файли запускаються через `mongosh`.

1. Скачати або клонувати репозиторій, відкрити термінал **у корені проєкту** (там, де лежать `dataset.csv` та `requirements.txt`).
2. Створити віртуальне середовище Python та встановити залежності:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install -r requirements.txt
   ```

3. Створити `.env` на основі `.env.example`:

   ```bash
   cp .env.example .env
   ```

   У файлі `.env` замінити `USERNAME`, `PASSWORD` та `CLUSTER_HOST` на власні дані MongoDB Atlas. Якщо пароль містить зарезервовані символи URI, їх слід URL-кодувати. **Ніколи не публікувати `.env`**, оскільки він містить облікові дані. Файл уже доданий до `.gitignore`.

4. Перевірити, що CSV-файл `dataset.csv` знаходиться в корені проєкту. **Запускати скрипти в такому порядку:**

   ```bash
   # 1. Завантаження сирих даних у spotify.tracks_raw
   python scripts/01_load_data.py

   # 2. Створення структурованої колекції spotify.tracks
   mongosh "$(python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["MONGO_URI"])')" --file scripts/02_transform.js

   # 3. Чотири обов’язкові запити
   mongosh "$(python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["MONGO_URI"])')" --file queries/part2_queries.js

   # 4. Дослідження індексів (виконане як додатковий практичний розділ)
   mongosh "$(python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["MONGO_URI"])')" --file part3_indexes.js
   ```

5. Перевірити результат у MongoDB Atlas: база даних `spotify` повинна містити колекції `tracks_raw` та `tracks`, по **113999 документів**. У папці [`results/`](results/) збережені приклад документа до/після трансформації та фактичний вивід усіх чотирьох запитів.

**Примітка щодо відтворюваності:** `01_load_data.py` при повторному запуску перестворює `tracks_raw`; `02_transform.js` перестворює `tracks`. Скрипт `part3_indexes.js` потрібно виконувати після трансформації й на колекції, де ще немає індексу `genre_popularity_danceability_idx`: інакше його перший блок `explain()` не буде справжнім виміром *до індексації*. У README нижче наведено збережені результати першого запуску до/після створення індексу.

## Частина 1. Завантаження даних та проєктування схеми

### 1.1. Завантаження сирих даних

**Мета:** завантажити набір Spotify Tracks Dataset із CSV-файлу в хмарну MongoDB Atlas, зберегти початкові поля для подальшої трансформації.

**Середовище:** macOS, Python (`pymongo`, `pandas`, `python-dotenv`, `tqdm`), MongoDB Atlas (кластер M0) і `mongosh`. Підключення зберігається у локальному файлі `.env` як змінна `MONGO_URI`; пароль та URI не додаються до Git.

**Файл завантаження:** [`scripts/01_load_data.py`](scripts/01_load_data.py). **Джерело даних:** `dataset.csv` (Spotify Tracks Dataset, Kaggle). База даних — `spotify`, початкова колекція — `tracks_raw`.

Послідовність роботи Python-скрипту:

1. Зчитування URI з `.env` через `load_dotenv()` та відкриття підключення `MongoClient(MONGO_URI)`.
2. Очищення `tracks_raw` перед повторним завантаженням (`drop()`), щоб не накопичувати дублікати між запусками.
3. Зчитування CSV за допомогою `pd.read_csv("dataset.csv")`: початковий набір містить **114000 рядків**.
4. Приведення `explicit` до типу `bool`, числових стовпців (наприклад, `popularity`, `duration_ms`) — до `int`, аудіопоказників (зокрема, `danceability`, `energy`, `tempo`) — до `float`.
5. Видалення записів із відсутнім `artists` або `track_name` (у цьому наборі відкинуто **1 запис**).
6. Завантаження отриманих документів через `insert_many()` пакетами по **1000** та перевірка кількості документів через `count_documents({})`.

Запуск із кореня проєкту:

```bash
python -m pip install -r requirements.txt
python scripts/01_load_data.py
```

**Фактичний результат:** `spotify.tracks_raw` містить **113999 документів**. Початкова структура є плоскою: `artists` — один рядок, а числові аудіохарактеристики зберігаються як окремі поля верхнього рівня.

### 1.2. Трансформація через Aggregation Pipeline

**Мета:** створити окрему колекцію `spotify.tracks` із документоорієнтованою структурою, не змінюючи `tracks_raw`.

**Файл трансформації:** [`scripts/02_transform.js`](scripts/02_transform.js). Трансформація виконується засобами MongoDB, а не Python.

Етапи конвеєра:

1. **`$project`** — вибір потрібних полів і тимчасове перейменування початкового рядка `artists` на `artists_raw`; поле `Unnamed: 0` не переноситься.
2. **`$addFields` + `$split` + `$map` + `$trim`** — перетворення списку виконавців, розділених `;`, на масив рядків, очищених від крайніх пробілів.
3. **`$addFields`** — створення вкладеного об’єкта `audio_features` із 12 характеристиками, розрахунок `duration_sec` та класифікація `popularity_tier`.
4. **`$unset`** — видалення тимчасового `artists_raw` і аудіополів верхнього рівня після перенесення у вкладений об’єкт.
5. **`$out: "tracks"`** — запис перетворених документів у нову колекцію `tracks`.

Обчислювані поля:

- `duration_sec = round(duration_ms / 1000, 1)` — тривалість у секундах;
- `popularity_tier = "high"`, якщо популярність ≥ 70;
- `popularity_tier = "medium"`, якщо популярність від 40 до 69;
- `popularity_tier = "low"`, якщо популярність менша за 40.

Запуск на macOS (зчитування URI із `.env` без виведення його в документацію):

```bash
mongosh "$(python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["MONGO_URI"])')" --file scripts/02_transform.js
```

**Фактичний результат перевірки в Atlas:**

| Колекція | Кількість документів | Призначення |
| --- | ---: | --- |
| `spotify.tracks_raw` | 113999 | Сирі дані з CSV |
| `spotify.tracks` | 113999 | Трансформовані документи |

#### Приклад документа до та після трансформації

Нижче наведено **той самий реальний трек** (`track_id: 5SuOikwiRyPMVoIQDJUgSV`) з обох колекцій.

**До трансформації (`tracks_raw`):**

```javascript
{
  track_id: "5SuOikwiRyPMVoIQDJUgSV",
  artists: "Gen Hoshino",
  album_name: "Comedy",
  track_name: "Comedy",
  popularity: 73,
  duration_ms: 230666,
  explicit: false,
  danceability: 0.676,
  energy: 0.461,
  key: 1,
  loudness: -6.746,
  mode: 0,
  speechiness: 0.143,
  acousticness: 0.0322,
  instrumentalness: 0.00000101,
  liveness: 0.358,
  valence: 0.715,
  tempo: 87.917,
  time_signature: 4,
  track_genre: "acoustic"
}
```

*У сирому документі також є технічне поле `Unnamed: 0`, яке не переноситься до `tracks`.*

**Після трансформації (`tracks`):**

```javascript
{
  track_id: "5SuOikwiRyPMVoIQDJUgSV",
  album_name: "Comedy",
  track_name: "Comedy",
  popularity: 73,
  duration_ms: 230666,
  explicit: false,
  track_genre: "acoustic",
  artists: ["Gen Hoshino"],
  audio_features: {
    danceability: 0.676,
    energy: 0.461,
    loudness: -6.746,
    speechiness: 0.143,
    acousticness: 0.0322,
    instrumentalness: 0.00000101,
    liveness: 0.358,
    valence: 0.715,
    tempo: 87.917,
    key: 1,
    mode: 0,
    time_signature: 4
  },
  duration_sec: 230.7,
  popularity_tier: "high"
}
```

Отже, `artists` перетворився з рядка на масив; 12 аудіопоказників згруповано в `audio_features`; `230666` мс стало `230.7` с; популярність `73` відповідає категорії `high`. **Кількість документів при трансформації не змінилась.** Повний вивід цієї перевірки наведено у [`results/part1_example.txt`](results/part1_example.txt).

### Теоретичне питання 1. Чому аудіохарактеристики винесені в окремий об’єкт `audio_features`?

Ці поля описують одну логічну сутність — аудіовластивості треку. Вкладення робить схему зрозумілішою, дозволяє обробляти групу характеристик разом і звертатися до окремих значень через dot notation, наприклад `"audio_features.tempo"` або `"audio_features.danceability"`.

**Коли вигідно:** коли характеристики належать конкретному треку, зберігаються та переважно зчитуються разом із ним. **Можливі недоліки:** довші шляхи до полів у запитах та індексах; при частих вибіркових оновленнях вкладених структур потрібно акуратно вказувати потрібне поле. Вкладення не завжди зручне, якщо дані мають незалежний життєвий цикл або потребують окремого керування.

### Теоретичне питання 2. Чому виконавці зберігаються як масив, а не як рядок?

Один трек може мати кількох виконавців. Наприклад, рядок `"Drake; Future"` перетворюється на масив `["Drake", "Future"]`. Це дозволяє знайти треки конкретного виконавця точним збігом елемента масиву (`{ artists: "Drake" }`), застосувати `$unwind` для групування за виконавцями та використовувати масивні оператори без повторного розбиття рядка в кожному запиті. Масив також усуває залежність пошуку від пробілів і символу `;` у вихідному тексті.

## Частина 2. MongoDB Queries

Усі чотири запити виконано над трансформованою колекцією `spotify.tracks` (113999 документів). Код реалізовано у файлі [`queries/part2_queries.js`](queries/part2_queries.js), запуск здійснювався через `mongosh`. Отримані кількості та приклади нижче — фактичні результати виконання, а не тестові дані.

**Запуск на macOS** (у корені проєкту, за наявності змінної `MONGO_URI` у `.env`):

```bash
mongosh "$(python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["MONGO_URI"])')" --file queries/part2_queries.js
```

Повний вивід чотирьох запитів збережено окремо у `results/part2_queries_output.txt`.

### Завдання 1. Треки для вечірки

**Умова:** танцювальність (`danceability`) і енергія (`energy`) строго вищі за `0.7`, а тривалість від `180000` до `300000` мс включно.

**Запит:**

```javascript
const partyFilter = {
  "audio_features.danceability": { $gt: 0.7 },
  "audio_features.energy": { $gt: 0.7 },
  duration_ms: { $gte: 180000, $lte: 300000 },
};

const partyTracks = spotify.tracks
  .find(partyFilter, {
    track_name: 1,
    artists: 1,
    duration_ms: 1,
    "audio_features.danceability": 1,
    "audio_features.energy": 1,
  })
  .limit(15)
  .toArray();

print("Знайдено треків:", spotify.tracks.countDocuments(partyFilter));
printjson(partyTracks);
```

**Результат:** знайдено **7311 треків**. Приклади з фактичного виводу:

| Трек            | Виконавці                 | `danceability` | `energy` | `duration_ms` |
| --------------- | ------------------------- | -------------: | -------: | ------------: |
| Hold On - Remix | Chord Overstreet, Deepend |          0.755 |     0.78 |        188133 |
| Kaleidoscope    | A Great Big World         |          0.709 |    0.913 |        229320 |
| Reza Forte      | BaianaSystem, BNegão      |          0.844 |    0.915 |        232826 |

**Пояснення:** `.find()` застосовує одночасно три критерії; усі умови об'єкта фільтра поєднуються логічним `AND`. `.limit(15)` обмежує лише вивід прикладів, тоді як `countDocuments()` рахує **всі** відповідні записи.

### Завдання 2. Виконавці, у яких усі треки популярні

**Умова:** виконавець має щонайменше 3 записи в наборі даних, і мінімальна популярність його треків — не нижча за 60. Потрібно отримати топ-20 виконавців, кількість треків, мінімальну та середню популярність.

**Aggregation Pipeline:**

```javascript
const popularArtists = spotify.tracks
  .aggregate([
    { $unwind: "$artists" },
    {
      $group: {
        _id: "$artists",
        track_count: { $sum: 1 },
        min_popularity: { $min: "$popularity" },
        avg_popularity: { $avg: "$popularity" },
      },
    },
    { $match: { track_count: { $gte: 3 }, min_popularity: { $gte: 60 } } },
    {
      $project: {
        _id: 0,
        artist: "$_id",
        track_count: 1,
        min_popularity: 1,
        avg_popularity: { $round: ["$avg_popularity", 1] },
      },
    },
    { $sort: { avg_popularity: -1, track_count: -1 } },
    { $limit: 20 },
  ])
  .toArray();
printjson(popularArtists);
```

**Результат:** отримано **топ-20 виконавців** (20 — обмеження виводу, а не кількість усіх можливих виконавців). Перші п'ять:

| Виконавець     | Кількість треків | Мін. популярність | Середня популярність |
| -------------- | ---------------: | ----------------: | -------------------: |
| Harry Styles   |                3 |                89 |                 92.0 |
| Luar La L      |                4 |                90 |                 90.5 |
| Olivia Rodrigo |                5 |                86 |                 87.4 |
| BYOR           |                4 |                87 |                 87.0 |
| IVE            |                3 |                79 |                 84.0 |

**Пояснення:** `$unwind` створює окремий запис для кожного виконавця треку, `$group` обчислює кількість, мінімум та середнє, а `$match` відбирає виконавців за обома критеріями. Оскільки перевіряється **мінімальна**, а не середня популярність, усі враховані треки виконавця мають популярність не нижчу за 60.

### Завдання 3. Треки з нетипово високим темпом

**Умова:** для кожного жанру обчислити середній темп `$avg` і стандартне відхилення сукупності `$stdDevPop`. Нетиповими вважати треки, темп яких **строго перевищує** поріг `mean + 2 * stdDev`.

**Aggregation Pipeline (основні кроки робочого скрипту):**

```javascript
const outlierGenres = spotify.tracks
  .aggregate([
    {
      $group: {
        _id: "$track_genre",
        avg_tempo: { $avg: "$audio_features.tempo" },
        std_dev_tempo: { $stdDevPop: "$audio_features.tempo" },
        tracks: {
          $push: {
            _id: "$_id",
            track_name: "$track_name",
            popularity: "$popularity",
            artists: "$artists",
            audio_features: { tempo: "$audio_features.tempo" },
          },
        },
      },
    },
    {
      $addFields: {
        outlier_threshold: {
          $add: ["$avg_tempo", { $multiply: [2, "$std_dev_tempo"] }],
        },
      },
    },
    {
      $project: {
        _id: 0,
        genre: "$_id",
        avg_tempo: { $round: ["$avg_tempo", 2] },
        outlier_threshold: { $round: ["$outlier_threshold", 2] },
        outlier_tracks: {
          $filter: {
            input: "$tracks",
            as: "track",
            cond: {
              $gt: ["$$track.audio_features.tempo", "$outlier_threshold"],
            },
          },
        },
      },
    },
    { $match: { "outlier_tracks.0": { $exists: true } } },
    { $sort: { genre: 1 } },
  ])
  .toArray();
```

**Результат:** **112 жанрів** мають принаймні один трек, який перевищує статистичний поріг. Кілька фактичних прикладів:

| Жанр     | Середній темп | Поріг нетипового темпу | Трек (виконавець)                         | Темп треку |
| -------- | ------------: | ---------------------: | ----------------------------------------- | ---------: |
| acoustic |        119.01 |                 178.52 | Can't Help Falling In Love (Kina Grannis) |     181.74 |
| afrobeat |        119.21 |                 171.78 | Breaco (Criolo)                           |    182.026 |
| alt-rock |        124.63 |                 183.07 | Heart-Shaped Box (Nirvana)                |    203.006 |

**Пояснення:** статистику обчислено окремо по кожному жанру. Порівняння виконується з **неокругленим** порогом; округлення у `$project` потрібне лише для показу. `$filter` залишає у `outlier_tracks` лише нетипові треки, а фінальний `$match` прибирає жанри без таких треків. Повний масив результатів великий, тому у звіті наведено вибірку; повний вивід є в текстовому файлі.

### Завдання 4. Треки для фонової роботи

**Умова:** `loudness < -10`, `speechiness < 0.1`, `instrumentalness > 0.5`, `explicit = false`.

**Запит:**

```javascript
const workMusicFilter = {
  "audio_features.loudness": { $lt: -10 },
  "audio_features.speechiness": { $lt: 0.1 },
  "audio_features.instrumentalness": { $gt: 0.5 },
  explicit: false,
};

const workTracks = spotify.tracks
  .find(workMusicFilter, {
    _id: 0,
    track_name: 1,
    artists: 1,
    track_genre: 1,
    explicit: 1,
    "audio_features.loudness": 1,
    "audio_features.speechiness": 1,
    "audio_features.instrumentalness": 1,
  })
  .sort({ popularity: -1 })
  .limit(20)
  .toArray();

print("Знайдено треків:", spotify.tracks.countDocuments(workMusicFilter));
printjson(workTracks);
```

**Результат:** знайдено **9324 треки**, у виводі наведено перші 20 за спаданням популярності.

| Трек                | Виконавець                                         | `loudness` | `speechiness` | `instrumentalness` | `explicit` |
| ------------------- | -------------------------------------------------- | ---------: | ------------: | -----------------: | ---------- |
| everything i wanted | Billie Eilish                                      |    -14.454 |        0.0994 |              0.657 | false      |
| Show Me How         | Men I Trust                                        |    -11.997 |        0.0415 |              0.534 | false      |
| Experience          | Ludovico Einaudi, Daniel Hope, I Virtuosi Italiani |    -10.634 |        0.0376 |              0.961 | false      |

**Пояснення:** запит використовує чотири одночасні критерії, вкладені аудіополя вказані через dot notation. `.sort({ popularity: -1 })` сортує вибірку, `.limit(20)` обмежує перелік прикладів, а `countDocuments()` рахує весь набір відповідних треків.

## Частина 3. Індекси та оптимізація

### Завдання 1. Аналіз запиту та індексація

Для оптимізації пошуку треків жанру `pop` із показником `danceability >= 0.7` було створено складений індекс:

```javascript
{
  track_genre: 1,
  popularity: -1,
  "audio_features.danceability": 1
}
```

**Результати до створення індексу:**

- План виконання: `COLLSCAN` + `SORT`.
- Перевірено документів: 113999.
- Повернуто документів: 354.
- Час виконання: 73 мс.

**Результати після створення індексу:**

- План виконання: `IXSCAN` + `FETCH`.
- Перевірено документів: 354.
- Перевірено ключів індексу: 412.
- Повернуто документів: 354.
- Час виконання: 2 мс.

**Висновок:**

Після створення складеного індексу MongoDB використовує `IXSCAN` замість повного сканування колекції `COLLSCAN`.

Кількість перевірених документів зменшилася зі 113999 до 354. Час виконання зменшився з 73 мс до 2 мс, що становить приблизно 36,5-кратне прискорення в цьому вимірі.

Використання індексу підтверджується полями `winningPlan`, `indexName` та `totalKeysExamined` у результаті `explain("executionStats")`.

Окремий етап `SORT` також зник, оскільки порядок сортування забезпечується індексом.

### Завдання 2. Створення складеного індексу для фонової музики

Для оптимізації запитів пошуку фонової музики створено складений індекс `work_music_idx` за трьома полями:

```javascript
{
  explicit: 1,
  "audio_features.instrumentalness": 1,
  "audio_features.speechiness": 1
}
```

Для перевірки використано метод `explain("executionStats")`.

**Результати виконання:**

- План виконання: `IXSCAN` + `FETCH`.
- Використаний індекс: `work_music_idx`.
- Повернуто документів: 9324.
- Перевірено документів: 16141.
- Перевірено ключів індексу: 16602.
- Час виконання: 54 мс.

**Висновок:**

MongoDB успішно використала складений індекс для фільтрації треків.

Це підтверджується наявністю `IXSCAN` та назви `work_music_idx` у плані виконання запиту.

Поле `explicit` використовується для пошуку за точним збігом, а поля `instrumentalness` і `speechiness` — для діапазонних умов.

Додатковий етап `FETCH` виконує перевірку поля `audio_features.loudness`, яке не входить до створеного індексу.

Отже, створений індекс використовується MongoDB, що підтверджує виконання вимог завдання.
