# MongoDB Atlas — Spotify Dataset

## Частина 1. Завантаження та проєктування схеми

Дані Spotify завантажені до MongoDB Atlas у базу `spotify`, колекцію `tracks_raw`.

Після трансформації за допомогою Aggregation Pipeline створено колекцію `tracks`, яка містить **113999 документів**.

### 1. Чому аудіохарактеристики винесені в окремий об'єкт `audio_features`?

Вкладений об'єкт дозволяє логічно згрупувати характеристики треку, такі як `danceability`, `energy`, `tempo` та `loudness`.

Це робить структуру документа зрозумілішою та спрощує роботу з пов'язаними полями.

**Переваги:** зручна організація даних, логічне групування та можливість звертатися до вкладених полів через dot notation.

**Недоліки:** складніші шляхи до полів у запитах та індексах, а також можливі незручності при частому оновленні вкладених структур.

Таке вкладення вигідне, коли характеристики логічно належать одному об'єкту й зазвичай використовуються разом.

### 2. Чому виконавці зберігаються як масив, а не як рядок?

Один трек може мати декількох виконавців. Масив дозволяє зберігати кожного виконавця як окремий елемент.

Наприклад:

`["Drake", "Future"]`

Це спрощує пошук треків конкретного виконавця за точним збігом елемента масиву, використання `$unwind` для аналізу кожного виконавця та групування треків за артистами.

На відміну від рядка з роздільниками, масив не потребує додаткового розбиття під час кожного запиту.

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
