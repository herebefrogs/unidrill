// Assemble a single self-contained audition.html (no modules, no fetch, works
// over file://) with every voxby candidate embedded: the CPlayer + each
// generated song.
//
//   node tools/build-audition.mjs   (run tools/voxby/gen.mjs first)

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const vxOut = path.join(root, 'voxby', 'out');
const gz = s => zlib.gzipSync(s, { level: 9 }).length;

const playerSrc = fs.readFileSync(path.join(root, 'voxby', 'player-small.js'), 'utf8')
  .replace('"use strict";', '');

const vxManifest = JSON.parse(fs.readFileSync(path.join(vxOut, 'manifest.json'), 'utf8'));
const voxby = vxManifest.map(m => {
  const lit = fs.readFileSync(path.join(vxOut, `${m.name}.min.js`), 'utf8').trim().replace(/;$/, '');
  return { ...m, engine: 'voxby', dataGz: gz(lit), lit };
});

// User's tracker exports (tools/exports/*.js) — the ground truth we'll actually
// ship. songToJS form: comments + `export default {…}`.
const compactExport = src => src
  .replace(/\/\/[^\n]*/g, '').replace(/export default/, '').replace(/\s+/g, '').replace(/;$/, '');
const exportsDir = path.join(root, 'exports');
const exported = (fs.existsSync(exportsDir) ? fs.readdirSync(exportsDir) : [])
  .filter(f => f.endsWith('.js')).map(f => {
    const raw = fs.readFileSync(path.join(exportsDir, f), 'utf8');
    const lit = compactExport(raw);
    const tag = (raw.match(/\/\/ ([A-Z][^\n]*bpm[^\n]*)/) || [])[1] || f;
    return { name: f.replace(/\.js$/, ''), engine: 'export', mode: tag, bpm: '', flavor: '',
      groove: 'tracker export', channels: (lit.match(/numChannels:(\d+)/) || [])[1] || '?',
      seconds: '', dataGz: gz(lit), lit };
  });

// Minified player-small.js gzips to ~1.4 KB (measured with terser); the raw
// gzip of the checked-in file is not what would ship.
const playerGz = 1403;
const all = [...exported, ...voxby];

const rows = all.map((c, i) => {
  const meta = c.engine === 'export'
    ? `${c.mode} · ${c.channels}ch · tracker export`
    : `${c.mode} · ${c.bpm}bpm · ${c.flavor} · ${c.groove} · ${c.channels}ch · ~${c.seconds}s`;
  return `  {
    idx: ${i}, name: ${JSON.stringify(c.name)}, engine: ${JSON.stringify(c.engine)},
    meta: ${JSON.stringify(meta)},
    dataGz: ${c.dataGz},
    song: ${c.lit}
  }`;
}).join(',\n');

const html = `<!doctype html><html><head><meta charset="utf-8">
<title>unidrill — music audition</title>
<style>
  body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#1a1a1f;color:#e8e8ea}
  h1{font-size:16px;margin:0 0 4px}
  .sub{color:#999;margin-bottom:20px}
  .card{background:#25252c;border:1px solid #33333c;border-radius:8px;padding:14px 16px;margin:8px 0;display:flex;gap:14px;align-items:center}
  .card.playing{border-color:#7a5cff;background:#2b2838}
  .card .name{font-weight:600;min-width:110px}
  .card .badge{font-size:11px;padding:2px 7px;border-radius:4px;background:#3a3a44}
  .card .badge.voxby{background:#2d5a4a;color:#8fe} .card .badge.export{background:#7a5cff;color:#fff}
  .card .meta{color:#aaa;font-size:12px;flex:1}
  .card .size{color:#8b8;font-variant-numeric:tabular-nums;font-size:12px}
  button{font:inherit;background:#3a3a48;color:#e8e8ea;border:0;border-radius:6px;padding:6px 12px;cursor:pointer}
  button:hover{background:#4a4a5a} button.stop{background:#7a3c3c}
  .controls{margin:16px 0;display:flex;gap:10px;align-items:center}
  .note{margin-top:24px;color:#888;font-size:12px;max-width:640px}
  code{background:#33333c;padding:1px 5px;border-radius:3px}
</style></head><body>
<h1>unidrill — background music audition</h1>
<div class="sub">Bouncy chiptune / playful — voxby. Player runtime (minified+gzip): CPlayer ≈ ${playerGz} B one-time; song data listed per row.</div>
<div class="controls">
  <label><input type="checkbox" id="loop" checked> loop</label>
  <button id="stopAll" class="stop">■ stop</button>
  <span id="status" style="color:#999"></span>
</div>
<div id="list"></div>
<div class="note">
  Each track renders to an AudioBuffer on first play (~1&nbsp;frame of work per channel), then loops that buffer.
  "size" is the gzipped <em>song data</em> only — add the one-time player cost above. Seamlessness of the loop point is what to listen for, plus timbre and whether it reads as "peppy".
</div>
<script>${playerSrc}</script>
<script>
const CANDIDATES = [
${rows}
];
const ctx = new (window.AudioContext || window.webkitAudioContext)();
let current = null, currentIdx = -1;
const $ = s => document.querySelector(s);
const buffers = {};

function renderVoxby(song){
  const p = new CPlayer(); p.init(song);
  while (p.generate() < 1) {}
  return p.createAudioBuffer(ctx);
}
function getBuffer(c){
  if (!buffers[c.name]) {
    $('#status').textContent = 'rendering ' + c.name + '…';
    buffers[c.name] = renderVoxby(c.song);
    $('#status').textContent = '';
  }
  return buffers[c.name];
}
function stop(){
  if (current) { try { current.stop(); } catch(e){} current = null; }
  currentIdx = -1;
  document.querySelectorAll('.card').forEach(el => el.classList.remove('playing'));
}
function play(c){
  ctx.resume();
  const wasIdx = currentIdx;
  stop();
  if (wasIdx === c.idx) return;
  const src = ctx.createBufferSource();
  src.buffer = getBuffer(c);
  src.loop = $('#loop').checked;
  src.connect(ctx.destination);
  src.start();
  current = src; currentIdx = c.idx;
  document.querySelectorAll('.card')[c.idx].classList.add('playing');
}
const list = $('#list');
CANDIDATES.forEach(c => {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = \`<button>▶ play</button><span class="name">\${c.name}</span>
    <span class="badge \${c.engine}">\${c.engine}</span>
    <span class="meta">\${c.meta}</span>
    <span class="size">\${c.dataGz} B gz</span>\`;
  el.querySelector('button').onclick = () => play(c);
  list.appendChild(el);
});
$('#stopAll').onclick = stop;
$('#loop').onchange = () => { if (current) current.loop = $('#loop').checked; };
</script>
</body></html>`;

const outPath = path.join(root, 'audition.html');
fs.writeFileSync(outPath, html);
console.log(`audition.html: ${(html.length / 1024).toFixed(0)} KB, ${all.length} candidates`);
console.log(`voxby player gzip: ${playerGz} B`);
for (const c of all) console.log(`  ${c.name.padEnd(14)} ${c.engine.padEnd(6)} ${c.dataGz} B gz data`);
