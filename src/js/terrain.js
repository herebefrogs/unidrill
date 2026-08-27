// pixel size of one terrain cell
export const CELL_SIZE = 8;

export const SAND = 0;
export const CLAY = 1;

const MATERIAL_COLOR = ['#e0c088', '#96633c'];

// deterministic 2D hash, returns a value in [0, 1)
const hash2D = (x, y) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// --- macro pattern pass -------------------------------------------------
// the map is first divided into large sections; each section deterministically
// rolls one of a few density patterns, giving direct control over how
// obstacle-heavy an area is instead of leaving density fully emergent from
// the blob field alone (Spelunky-style room-category pass, applied to a
// continuous field instead of discrete rooms)
export const CLEAR = 0;
export const SPARSE = 1;
export const DENSE = 2;
export const FILLED = 3;

// probability of picking each pattern; must sum to 1
const PATTERN_WEIGHTS = [0.15, 0.50, 0.35, 0];

const SECTION_SIZE = 480; // px per macro section

const sectionPattern = (sx, sy) => {
  const roll = hash2D(sx + 99991, sy + 99991);
  let acc = 0;
  for (let p = 0; p < PATTERN_WEIGHTS.length; p++) {
    acc += PATTERN_WEIGHTS[p];
    if (roll < acc) return p;
  }
  return PATTERN_WEIGHTS.length - 1;
};

// per-pattern rock blob shape/frequency, sharing a single grid (see ROCK_CELL
// below) so a blob's size/chance always comes from whichever section its own
// (pre-jitter) grid cell belongs to, not from whichever section is querying
// it — that's what lets a blob spill naturally across a section border
// instead of cutting off at the edge. SPARSE reads as "more rocks, but
// smaller" (high spawn chance, small radius), DENSE as "fewer rocks, but
// bigger" (low spawn chance, large radius). CLEAR/FILLED spawn no blobs of
// their own (FILLED is unconditionally solid instead, see below).
const PATTERN_ROCK = [
  null,                                     // CLEAR
  { minR: 18, maxR: 32, chance: 0.5 },      // SPARSE
  { minR: 70, maxR: 115, chance: 0.35 },    // DENSE
  null,                                     // FILLED
];

// grid cell size for rock blob candidates; must stay >= the largest maxR
// above, inflated by the worst-case wobble amplitude (1 + 0.3 + 0.15 = 1.45x),
// so a blob can never reach past its immediate neighbor cell (keeps the 3x3
// neighborhood scan in blobDepth exhaustive)
const ROCK_CELL = 170;

// scatter one jittered blob (center + radius) per grid cell, sized/chanced by
// whichever macro section this candidate's own cell falls into; null means
// "no blob here" (section is CLEAR, or this candidate lost its spawn roll).
// amp1/phase1/amp2/phase2 drive a two-harmonic radius wobble (see blobDepth)
// so the blob's own boundary is a lumpy silhouette, not a perfect circle —
// jittering the center alone can't achieve that, since a union of perfect
// circles always has smooth circular-arc edges no matter how they're placed.
const blobAt = (gx, gy) => {
  const sx = Math.floor(gx * ROCK_CELL / SECTION_SIZE);
  const sy = Math.floor(gy * ROCK_CELL / SECTION_SIZE);
  const cfg = PATTERN_ROCK[sectionPattern(sx, sy)];
  if (!cfg || hash2D(gx + 31337, gy + 31337) >= cfg.chance) return null;
  return {
    x: (gx + hash2D(gx, gy)) * ROCK_CELL,
    y: (gy + hash2D(gx, gy + 1)) * ROCK_CELL,
    r: cfg.minR + hash2D(gx + 1, gy) * (cfg.maxR - cfg.minR),
    amp1: 0.15 + hash2D(gx + 2, gy) * 0.15,
    phase1: hash2D(gx, gy + 2) * 6.28,
    amp2: 0.05 + hash2D(gx + 3, gy) * 0.1,
    phase2: hash2D(gx, gy + 3) * 6.28,
  };
};

// how deep inside the nearest blob (x,y) falls: 0 at/outside its edge, 1 at
// its center. Scans the surrounding grid cells since a blob can spill into
// its neighbors. Overlapping blobs merge into bigger, irregular clusters.
// Each blob's effective radius wobbles with angle (two sine harmonics) so
// its edge reads as a lumpy rock outline instead of a smooth circular arc.
const blobDepth = (x, y) => {
  const gx = Math.floor(x / ROCK_CELL), gy = Math.floor(y / ROCK_CELL);
  let best = 0;
  for (let ny = gy - 1; ny <= gy + 1; ny++) {
    for (let nx = gx - 1; nx <= gx + 1; nx++) {
      const b = blobAt(nx, ny);
      if (!b) continue;
      const dx = x - b.x, dy = y - b.y;
      const angle = Math.atan2(dy, dx);
      const wobble = 1 + b.amp1 * Math.sin(3 * angle + b.phase1) + b.amp2 * Math.sin(7 * angle + b.phase2);
      const depth = 1 - Math.hypot(dx, dy) / (b.r * wobble);
      if (depth > best) best = depth;
    }
  }
  return best;
};

export const sampleMaterial = (x, y) => {
  const pattern = sectionPattern(Math.floor(x / SECTION_SIZE), Math.floor(y / SECTION_SIZE));
  if (pattern === FILLED) return CLAY;
  return blobDepth(x, y) > 0 ? CLAY : SAND;
};

export const materialColor = type => MATERIAL_COLOR[type];
