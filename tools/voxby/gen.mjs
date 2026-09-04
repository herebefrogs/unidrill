// Headless voxby song generator.
//
// Runs the voxby procedural composer (songgen -> songwrite -> engine) entirely
// in Node, renders each candidate to a .wav for auditioning, and writes the
// compact song module + JSON for wiring into the game.
//
//   node tools/voxby/gen.mjs
//
// Output lands in tools/voxby/out/.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// presets.js is SoundBox-era: it assigns an implicit global. Give it one.
globalThis.gInstrumentPresets = [];
const presetsSrc = fs.readFileSync(path.join(here, 'presets.js'), 'utf8')
  .replace('gInstrumentPresets =', 'globalThis.gInstrumentPresets =');
(0, eval)(presetsSrc);
const presets = globalThis.gInstrumentPresets;

// player-small.js is a plain script defining `var CPlayer`.
const playerSrc = fs.readFileSync(path.join(here, 'player-small.js'), 'utf8')
  .replace('"use strict";', '') + '\n;globalThis.CPlayer = CPlayer;';
(0, eval)(playerSrc);
const CPlayer = globalThis.CPlayer;

const engine = await import('./engine.js');
const { generate } = await import('./songgen.js');
const { scoreToNewSong } = await import('./songwrite.js');
const { makeRng } = await import('./rng.js');

// --- candidates: bouncy chiptune / playful --------------------------------
// One spec per audition track. `mode` picks the design; `flavor` pins the
// harmonic vocabulary (Chiptune = the 8-bit sound); seed makes it reproducible.
const CANDIDATES = [
  // kept
  { name: 'adv-chip-a',  mode: 'Adventure', flavor: 'Chiptune', bpm: 120, bars: 8, seed: 0x1113 },
  { name: 'town-chip',   mode: 'Town',      flavor: 'Chiptune', bpm: 114, bars: 8, seed: 0x6cae },
  // round 3 — variations (bpm/groove/kit/melody roll from the seed)
  { name: 'adv-chip-2',  mode: 'Adventure', flavor: 'Chiptune', bars: 8, seed: 0xa17c },
  { name: 'adv-chip-3',  mode: 'Adventure', flavor: 'Chiptune', bars: 8, seed: 0x4e8b },
  { name: 'town-chip-2', mode: 'Town',      flavor: 'Chiptune', bars: 8, seed: 0xd932 },
  { name: 'town-chip-3', mode: 'Town',      flavor: 'Chiptune', bars: 8, seed: 0x2f55 },
  // repro check — user generated these in the voxby tracker
  { name: 'game-battle', mode: 'Battle',    bpm: 146, bars: 8, seed: 2214127632 },
  { name: 'title-menu',  mode: 'Menu',      bpm: 100, bars: 8, seed: 1589023739 },
];

const manifest = [];

for (const spec of CANDIDATES) {
  const rnd = makeRng(spec.seed);
  const score = generate(spec, rnd);
  const { song, ok, warnings } = scoreToNewSong(score, presets);
  if (!ok) { console.error(`${spec.name}: FAILED`, warnings); continue; }
  if (warnings.length) console.warn(`${spec.name}:`, warnings.join(' '));

  // Render to WAV (no AudioContext needed).
  const p = new CPlayer();
  p.init(song);
  while (p.generate() < 1) { /* spin */ }
  const wav = Buffer.from(p.createWave());
  fs.writeFileSync(path.join(outDir, `${spec.name}.wav`), wav);

  // Compact module + JSON for the game / audition page.
  const js = engine.songToJS(song);
  fs.writeFileSync(path.join(outDir, `${spec.name}.js`), js);
  fs.writeFileSync(path.join(outDir, `${spec.name}.json`), JSON.stringify(song));

  const seconds = (song.rowLen * song.patternLen * (song.endPattern + 1)) / 44100;
  manifest.push({
    name: spec.name, mode: score.mode, bpm: score.bpm, flavor: spec.flavor,
    groove: score.groove, kit: score.kit, channels: song.numChannels,
    seconds: +seconds.toFixed(1), wavKB: +(wav.length / 1024).toFixed(0),
    jsonBytes: fs.statSync(path.join(outDir, `${spec.name}.json`)).size,
  });
  console.log(`${spec.name}: ${score.mode} ${score.bpm}bpm ${score.groove} / ${score.kit}, ` +
    `${song.numChannels}ch, ${seconds.toFixed(1)}s`);
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} candidates -> ${outDir}`);
