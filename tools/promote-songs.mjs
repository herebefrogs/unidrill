// Compact the tracker exports in tools/exports/ into src/js/ as shippable
// modules. Re-run whenever a song is re-exported from voxby.
//
//   node tools/promote-songs.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, '..', 'src', 'js');

for (const f of fs.readdirSync(path.join(root, 'exports')).filter(f => f.endsWith('.js'))) {
  const raw = fs.readFileSync(path.join(root, 'exports', f), 'utf8');
  const tag = (raw.match(/\/\/ ([A-Z][^\n]*bpm[^\n]*)/) || [])[1] || '';
  const body = raw
    .replace(/\/\/[^\n]*/g, '')      // strip comments
    .replace(/\s+/g, '')             // strip whitespace
    .replace(/^exportdefault/, '')
    .replace(/;$/, '');
  const out = `// ${tag}\n// Exported from the voxby tracker; compacted by tools/promote-songs.mjs.\n// Plays through CPlayer in sound.js.\nexport default ${body};\n`;
  fs.writeFileSync(path.join(srcDir, f), out);
  console.log(`${f}  ${body.length} B  (${tag})`);
}
