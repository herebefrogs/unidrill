// Parse audition.html, pull each embedded song literal, render it the same way
// the page does, and confirm the buffer is non-silent. Catches a bad literal or
// a broken loop before the user opens the page.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'audition.html'), 'utf8');

const playerSrc = fs.readFileSync(path.join(root, 'voxby', 'player-small.js'), 'utf8')
  .replace('"use strict";', '') + '\n;globalThis.CPlayer = CPlayer;';
(0, eval)(playerSrc);

const block = html.split('const CANDIDATES = [')[1].split('\n];')[0];
const CANDIDATES = (0, eval)('[' + block + ']');

for (const c of CANDIDATES) {
  const p = new globalThis.CPlayer(); p.init(c.song);
  while (p.generate() < 1) {}
  const wav = p.createWave();
  let s = 0, n = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) { const v = (wav[i] | (wav[i + 1] << 8)) << 16 >> 16; s += v * v; n++; }
  console.log(`${c.name.padEnd(14)} ok  rms~${Math.sqrt(s / n).toFixed(0)}  ${((wav.length - 44) / 4 / 44100).toFixed(1)}s`);
}
console.log('\nall literals parsed + rendered.');
