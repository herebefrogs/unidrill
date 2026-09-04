import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
for (const f of fs.readdirSync(outDir).filter(f => f.endsWith('.wav'))) {
  const buf = fs.readFileSync(path.join(outDir, f));
  let sum = 0, peak = 0, n = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    sum += s * s; peak = Math.max(peak, Math.abs(s)); n++;
  }
  const rms = Math.sqrt(sum / n);
  console.log(f.padEnd(16), 'rms', rms.toFixed(0).padStart(6), 'peak', String(peak).padStart(6),
    peak >= 32767 ? 'CLIPPING' : '');
}
