import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const names = fs.readdirSync(outDir)
  .filter(f => f.endsWith('.js') && !f.endsWith('.min.js'))
  .map(f => f.slice(0, -3));

// The compact form we'd actually ship: strip the export/comments, keep just the
// object literal, drop all whitespace.
const compact = src => src
  .replace(/\/\/[^\n]*/g, '')
  .replace(/export default/, '')
  .replace(/\s+/g, '')
  .replace(/;$/, '');

console.log('name'.padEnd(14), 'rawJS  compact  gzip');
for (const n of names) {
  const src = fs.readFileSync(path.join(outDir, `${n}.js`), 'utf8');
  const c = compact(src);
  const gz = zlib.gzipSync(c, { level: 9 }).length;
  console.log(n.padEnd(14), String(src.length).padStart(5), String(c.length).padStart(7), String(gz).padStart(5));
  fs.writeFileSync(path.join(outDir, `${n}.min.js`), c);
}
