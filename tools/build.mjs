// One-shot: regenerate voxby candidates, measure sizes, assemble audition.html,
// verify every embedded literal renders, refresh the WAV previews.
//
//   node tools/build.mjs

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const run = f => execFileSync('node', [path.join(root, f)], { stdio: 'inherit' });

run('voxby/gen.mjs');
run('voxby/measure.mjs');
run('build-audition.mjs');
run('verify-audition.mjs');

const prev = path.join(root, '_wav_previews');
fs.mkdirSync(prev, { recursive: true });
for (const f of fs.readdirSync(prev)) fs.rmSync(path.join(prev, f));
for (const f of fs.readdirSync(path.join(root, 'voxby', 'out')).filter(f => f.endsWith('.wav'))) {
  fs.copyFileSync(path.join(root, 'voxby', 'out', f), path.join(prev, f));
}
console.log('\n_wav_previews refreshed.');
