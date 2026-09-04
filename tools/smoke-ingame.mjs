// Render both promoted src/js songs through the trimmed src/js/player.js with a
// stub AudioContext, exactly as sound.js's renderSong would. Confirms the
// vendored+trimmed CPlayer and the compacted song modules agree.

import { CPlayer } from '../src/js/player.js';
import SONG_GAME from '../src/js/song-game.js';
import SONG_TITLE from '../src/js/song-title.js';

const stubCtx = {
  createBuffer: (ch, len, rate) => ({
    _d: Array.from({ length: ch }, () => new Float32Array(len)),
    getChannelData(i) { return this._d[i]; },
  }),
};

for (const [name, song] of [['song-game', SONG_GAME], ['song-title', SONG_TITLE]]) {
  const t0 = performance.now();
  const p = new CPlayer();
  p.init(song);
  while (p.generate() < 1) {}
  const buf = p.createAudioBuffer(stubCtx);
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); sum += d[i] * d[i]; }
  console.log(`${name.padEnd(11)} ${(d.length / 44100).toFixed(1)}s  peak ${peak.toFixed(3)}  rms ${Math.sqrt(sum / d.length).toFixed(4)}  render ${(performance.now() - t0).toFixed(0)}ms`);
}
