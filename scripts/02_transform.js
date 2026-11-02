
const spotify = db.getSiblingDB("spotify");

spotify.tracks.drop();

spotify.tracks_raw.aggregate([
  {
    $project: {
      _id: 0,
      track_id: 1,
      track_name: 1,
      album_name: 1,
      explicit: 1,
      popularity: 1,
      duration_ms: 1,
      track_genre: 1,
      artists_raw: "$artists",
      danceability: 1,
      energy: 1,
      loudness: 1,
      speechiness: 1,
      acousticness: 1,
      instrumentalness: 1,
      liveness: 1,
      valence: 1,
      tempo: 1,
      key: 1,
      mode: 1,
      time_signature: 1
    }
  },

  {
    $addFields: {
      artists: {
        $map: {
          input: { $split: ["$artists_raw", ";"] },
          as: "artist",
          in: { $trim: { input: "$$artist" } }
        }
      }
    }
  },

  {
    $addFields: {
      audio_features: {
        danceability: "$danceability",
        energy: "$energy",
        loudness: "$loudness",
        speechiness: "$speechiness",
        acousticness: "$acousticness",
        instrumentalness: "$instrumentalness",
        liveness: "$liveness",
        valence: "$valence",
        tempo: "$tempo",
        key: "$key",
        mode: "$mode",
        time_signature: "$time_signature"
      },

      duration_sec: {
        $round: [
          { $divide: ["$duration_ms", 1000] },
          1
        ]
      },

      popularity_tier: {
        $switch: {
          branches: [
            {
              case: { $gte: ["$popularity", 70] },
              then: "high"
            },
            {
              case: { $gte: ["$popularity", 40] },
              then: "medium"
            }
          ],
          default: "low"
        }
      }
    }
  },

  {
    $unset: [
      "artists_raw",
      "danceability",
      "energy",
      "loudness",
      "speechiness",
      "acousticness",
      "instrumentalness",
      "liveness",
      "valence",
      "tempo",
      "key",
      "mode",
      "time_signature"
    ]
  },

  {
    $out: "tracks"
  }
]);

print("Трансформацію завершено!");
print(
  "Документів у tracks: " +
  spotify.tracks.countDocuments()
);
printjson(spotify.tracks.findOne());
