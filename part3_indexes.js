
// mongosh "$(python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["MONGO_URI"])')" --file part3_indexes.js
const spotify = db.getSiblingDB("spotify");
const tracks = spotify.tracks;

print("\n<----======= ЧАСТИНА 3. ЗАВДАННЯ 1 =====--------->");

const filter = {
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
};

const sort = { popularity: -1 };

print("\n-<<<-- ДО ІНДЕКСАЦІЇ --->>>");

const before = tracks
  .find(filter)
  .sort(sort)
  .explain("executionStats");

printjson({
  nReturned: before.executionStats.nReturned,
  totalDocsExamined: before.executionStats.totalDocsExamined,
  totalKeysExamined: before.executionStats.totalKeysExamined,
  executionTimeMillis: before.executionStats.executionTimeMillis,
  winningPlan: before.queryPlanner.winningPlan
});

print("\n<<<<--- СТВОРЕННЯ ІНДЕКСУ --->>>");

const indexName = tracks.createIndex(
  {
    track_genre: 1,
    popularity: -1,
    "audio_features.danceability": 1
  },
  { name: "genre_popularity_danceability_idx" }
);

print("Створено індекс:", indexName);

print("\n--- ПІСЛЯ ІНДЕКСАЦІЇ ---");

const after = tracks
  .find(filter)
  .sort(sort)
  .explain("executionStats");

printjson({
  nReturned: after.executionStats.nReturned,
  totalDocsExamined: after.executionStats.totalDocsExamined,
  totalKeysExamined: after.executionStats.totalKeysExamined,
  executionTimeMillis: after.executionStats.executionTimeMillis,
  winningPlan: after.queryPlanner.winningPlan
});

print("\n<<<<<= ГОТОВО =>>>>>>>>");


print("\n========== ЧАСТИНА 3. ЗАВДАННЯ 2 ==========");

const workFilter = {
  explicit: false,
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 },
  "audio_features.loudness": { $lt: -10 }
};

print("\n--- СТВОРЕННЯ ІНДЕКСУ ---");

const workIndexName = tracks.createIndex(
  {
    explicit: 1,
    "audio_features.instrumentalness": 1,
    "audio_features.speechiness": 1
  },
  {
    name: "work_music_idx"
  }
);

print("Створено індекс:", workIndexName);

print("\n--- EXPLAIN ---");

const workExplain = tracks
  .find(workFilter)
  .explain("executionStats");

printjson({
  nReturned: workExplain.executionStats.nReturned,
  totalDocsExamined:
    workExplain.executionStats.totalDocsExamined,
  totalKeysExamined:
    workExplain.executionStats.totalKeysExamined,
  executionTimeMillis:
    workExplain.executionStats.executionTimeMillis,
  winningPlan:
    workExplain.queryPlanner.winningPlan
});

print("\n========== ЗАВДАННЯ 2 ГОТОВО ==========");

