import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const playerSrc = fs.readFileSync(path.join(root, 'voxby', 'player-small.js'), 'utf8')
  .replace('"use strict";', '') + '\n;globalThis.CPlayer = CPlayer;';
(0, eval)(playerSrc);

for (const f of ['song-game.js', 'song-title.js']) {
  const src = fs.readFileSync(path.join(root, 'exports', f), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/export default/, 'globalThis.__s =');
  (0, eval)(src);
  const song = globalThis.__s;
  const t0 = performance.now();
  const p = new globalThis.CPlayer();
  p.init(song);
  while (p.generate() < 1) {}
  const ms = performance.now() - t0;
  const secs = song.rowLen * song.patternLen * (song.endPattern + 1) / 44100;
  console.log(`${f.padEnd(15)} ${song.numChannels}ch ${secs.toFixed(1)}s  render ${ms.toFixed(0)} ms`);
}
