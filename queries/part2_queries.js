// mongosh "$(python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["MONGO_URI"])')" --file queries/part2_queries.js
const spotify = db.getSiblingDB("spotify");

const filter = {
  "audio_features.danceability": { $gt: 0.7 },
  "audio_features.energy": { $gt: 0.7 },
  duration_ms: { $gte: 180000, $lte: 300000 }
};

const tracks = spotify.tracks
  .find(filter, {
    track_name: 1,
    artists: 1,
    duration_ms: 1,
    "audio_features.danceability": 1,
    "audio_features.energy": 1
  })
  .limit(15)
  .toArray();

print(" Треки для вечірки");
print("Знайдено треків:", spotify.tracks.countDocuments(filter));
printjson(tracks);


print("\n(<========== ЗАВДАННЯ 2 ==========>)");

const popularArtists = spotify.tracks.aggregate([
  {
    $unwind: "$artists"
  },

  {
    $group: {
      _id: "$artists",
      track_count: { $sum: 1 },
      min_popularity: { $min: "$popularity" },
      avg_popularity: { $avg: "$popularity" }
    }
  },

  {
    $match: {
      track_count: { $gte: 3 },
      min_popularity: { $gte: 60 }
    }
  },

  {
    $project: {
      _id: 0,
      artist: "$_id",
      track_count: 1,
      min_popularity: 1,
      avg_popularity: {
        $round: ["$avg_popularity", 1]
      }
    }
  },
  {
    $sort: {
      avg_popularity: -1,
      track_count: -1
    }
  },

  // топ-20
  {
    $limit: 20
  }
]).toArray();

printjson(popularArtists);
print("Знайдено артистів--->", popularArtists.length);


print("\n-(<========== ЗАВДАННЯ 3 ==========>)-");

const outlierGenres = spotify.tracks.aggregate([
  {
    $group: {
      _id: "$track_genre",

      avg_tempo: {
        $avg: "$audio_features.tempo"
      },

      std_dev_tempo: {
        $stdDevPop: "$audio_features.tempo"
      },

      tracks: {
        $push: {
          _id: "$_id",
          track_name: "$track_name",
          popularity: "$popularity",
          artists: "$artists",
          audio_features: {
            tempo: "$audio_features.tempo"
          }
        }
      }
    }
  },

  {
    $addFields: {
      outlier_threshold: {
        $add: [
          "$avg_tempo",
          { $multiply: [2, "$std_dev_tempo"] }
        ]
      }
    }
  },

  {
    $project: {
      _id: 0,
      genre: "$_id",

      avg_tempo: {
        $round: ["$avg_tempo", 2]
      },

      outlier_threshold: {
        $round: ["$outlier_threshold", 2]
      },

      outlier_tracks: {
        $filter: {
          input: "$tracks",
          as: "track",
          cond: {
            $gt: [
              "$$track.audio_features.tempo",
              "$outlier_threshold"
            ]
          }
        }
      }
    }
  },

  {
    $match: {
      "outlier_tracks.0": { $exists: true }
    }
  },

  {
    $sort: {
      genre: 1
    }
  }
]).toArray();

print("Жанрів із нетиповими треками-", outlierGenres.length);
printjson(outlierGenres);



print("\n========== ЗАВДАННЯ 4 ==========");

const workMusicFilter = {
  "audio_features.loudness": { $lt: -10 },
  "audio_features.speechiness": { $lt: 0.1 },
  "audio_features.instrumentalness": { $gt: 0.5 },
  explicit: false
};

const workTracks = spotify.tracks.find(
  workMusicFilter,
  {
    _id: 0,
    track_name: 1,
    artists: 1,
    track_genre: 1,
    explicit: 1,
    "audio_features.loudness": 1,
    "audio_features.speechiness": 1,
    "audio_features.instrumentalness": 1
  }
)
.sort({ popularity: -1 })
.limit(20)
.toArray();

print("Завдання 4. Треки для фонової роботи");

print(
  "Знайдено треків---",
  spotify.tracks.countDocuments(workMusicFilter)
);

print("\n20 треків:");
printjson(workTracks);
