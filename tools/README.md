# Music prototyping scaffold

Tooling for choosing + wiring the background music. The chosen tracks were
generated in the [voxby](https://github.com/Rybar/voxby) tracker and exported;
this scaffold auditions candidates and promotes exports into `src/`.

## What shipped

| `src/js/` file | source |
|---|---|
| `player.js` | SoundBox `player-small.js`, zlib-licensed, trimmed to init/generate/createAudioBuffer |
| `song-game.js` | `tools/exports/song-game.js` (Battle 146bpm), compacted |
| `song-title.js` | `tools/exports/song-title.js` (Menu 100bpm), compacted |
| `sound.js` | `renderSong` / `playMusic` / `stopMusic` / `resumeAudio` / `suspendAudio` |

## Layout

| Path | Committed? | What |
|---|---|---|
| `exports/*.js` | yes | verbatim voxby tracker exports — the editable source of truth |
| `promote-songs.mjs` | yes | `exports/*.js` → compacted `src/js/*.js` |
| `smoke-ingame.mjs` | yes | render the promoted songs through `src/js/player.js` (stub ctx) |
| `voxby/*.js` | no (GPL3) | vendored voxby composer for the seed→song experiments |
| `voxby/gen.mjs` etc. | yes | headless candidate generation + size measurement |
| `build.mjs` | yes | gen → measure → audition → verify → wav previews |
| `build-audition.mjs` | yes | assembles `audition.html` (embeds `exports/` + generated candidates) |
| `_wav_previews/`, `audition.html`, `voxby/out/` | no | large / regenerable |

## Re-export a song from voxby

1. Export from the tracker, save over `tools/exports/song-game.js` (or `-title`).
2. `node tools/promote-songs.mjs`
3. `node tools/smoke-ingame.mjs` to confirm it renders.

## Regenerate the audition page

```
node tools/build.mjs
```

Needs the vendored `voxby/*.js` — re-fetch with
`curl -sfL https://raw.githubusercontent.com/Rybar/voxby/master/<file>.js -o tools/voxby/<file>.js`
for: songgen songwrite engine scales chords rhythms rng presets common player-small
