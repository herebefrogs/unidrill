// pixel size of one terrain cell
export const CELL_SIZE = 8;

export const SAND = 0;
export const CLAY = 1;

const MATERIAL_COLOR = ['#e0c088', '#96633c'];

// deceleration (px/sec^2) the drill suffers while cutting through each
// material - the "drag" half of the momentum loop. Parallel to
// MATERIAL_COLOR (SAND, CLAY). Sand barely bites; clay eats momentum fast.
// A baseline entropy term (material-independent) is added on top in game.js.
export const MATERIAL_DRAG = [90, 300];

// ---- run seed --------------------------------------------------------
// Two seed strings, each folded to a uint32 constant mixed into hash2D:
// one shapes the terrain (macro sections + rock blobs), one the dust
// field. setMapSeed() is called once at boot from the URL seed (game.js);
// the values never change during a run, so hash2D stays a pure function of
// (x, y) within a run — order-independent, safe to re-sample on repaint.
// Both default to 0, which leaves the hash identical to the unseeded map.
let terrainSeed = 0;
let dustSeed = 0;

// xfnv1a fold of a string to a uint32 (same construction as utils' seedRand)
const foldSeed = str => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};

export const setMapSeed = (terrainStr, dustStr) => {
  terrainSeed = foldSeed(terrainStr);
  dustSeed = foldSeed(dustStr);
};

// deterministic 2D hash keyed on (x, y, seed), returns a value in [0, 1).
// The dust pass calls it through dustHash() (dustSeed); every other caller
// takes terrainSeed by default. seed 0 => Math.imul(x ^ 0, …) / (y + 0),
// i.e. the original unseeded hash.
const hash2D = (x, y, seed = terrainSeed) => {
  let h = Math.imul(x ^ seed, 374761393) ^ Math.imul(y + seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const dustHash = (x, y) => hash2D(x, y, dustSeed);

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

// --- dust field pass --------------------------------------------------
// a pass parallel to sampleMaterial(), on its OWN microgrid — never the
// rock-blob grid or the macro sections. Answers NONE / SPARSE / DENSE per
// CELL_SIZE cell; dust overlays whatever substrate is there (sand or clay).
// Nothing stored — recomputed on demand like the rest of the terrain.
export const DUST_NONE = 0;
export const DUST_SPARSE = 1;
export const DUST_DENSE = 2;

// probability of each dust-patch category per dust-grid cell; must sum to 1.
// DENSE is rarest (bigger yield + the only momentum top-up).
const DUST_WEIGHTS = [0.66, 0.25, 0.09];

// px per dust-patch candidate cell; must stay >= the largest maxR below
// inflated by the worst-case wobble (1 + 0.40 + 0.20 = 1.6x), so a patch
// can never reach past its immediate neighbor (keeps sampleDust's 3x3 scan
// exhaustive)
const DUST_CELL = 132;

// per-category patch radius range (px). SPARSE patches are wider but only
// ~25% filled (quarter-grid dither mask); DENSE patches are tighter but solid.
const DUST_PATCH = [
  null,                     // NONE
  { minR: 38, maxR: 76 },   // SPARSE
  { minR: 22, maxR: 46 },   // DENSE
];

// one jittered dust patch per grid cell, or null when the cell rolled NONE.
// amp/phase drive the same two-harmonic radius wobble as the rock blobs
// (see dustContains) so the patch outline is lumpy, not a clean circle.
const dustPatchAt = (gx, gy) => {
  const roll = dustHash(gx + 54812, gy + 54812);
  let acc = 0, cat = 0;
  for (; cat < DUST_WEIGHTS.length - 1; cat++) {
    acc += DUST_WEIGHTS[cat];
    if (roll < acc) break;
  }
  const cfg = DUST_PATCH[cat];
  if (!cfg) return null;
  return {
    cat,
    x: (gx + dustHash(gx + 7, gy + 7)) * DUST_CELL,
    y: (gy + dustHash(gx + 7, gy + 11)) * DUST_CELL,
    r: cfg.minR + dustHash(gx + 13, gy + 7) * (cfg.maxR - cfg.minR),
    amp1: 0.20 + dustHash(gx + 17, gy + 7) * 0.20,
    phase1: dustHash(gx + 7, gy + 17) * 6.28,
    amp2: 0.08 + dustHash(gx + 23, gy + 7) * 0.12,
    phase2: dustHash(gx + 7, gy + 23) * 6.28,
  };
};

// is (x,y) inside this patch? radius wobbles with angle (two sine harmonics)
// so the boundary reads as an irregular splat, not a circular arc
const dustContains = (p, x, y) => {
  const dx = x - p.x, dy = y - p.y;
  const angle = Math.atan2(dy, dx);
  const wobble = 1 + p.amp1 * Math.sin(3 * angle + p.phase1) + p.amp2 * Math.sin(5 * angle + p.phase2);
  return Math.hypot(dx, dy) <= p.r * wobble;
};

// dither mask for SPARSE patches: a quarter grid (every other cell on every
// other row, ~25% fill), deliberately NOT a per-cell hash roll (reads as
// noise). A regular lattice was picked over staggered/diagonal masks on
// purpose — the eye locks onto the grid and stops reading the coarse cell
// size as graininess. x, y are already CELL_SIZE-aligned here (paintRow).
const dustDitherLit = (x, y) => {
  const cx = Math.floor(x / CELL_SIZE), cy = Math.floor(y / CELL_SIZE);
  return (cx & 1) === 0 && (cy & 1) === 0;
};

export const sampleDust = (x, y) => {
  const gx = Math.floor(x / DUST_CELL), gy = Math.floor(y / DUST_CELL);
  let found = DUST_NONE;
  for (let ny = gy - 1; ny <= gy + 1; ny++) {
    for (let nx = gx - 1; nx <= gx + 1; nx++) {
      const p = dustPatchAt(nx, ny);
      if (!p || !dustContains(p, x, y)) continue;
      if (p.cat === DUST_DENSE) return DUST_DENSE;   // dense fills solid, wins outright
      if (dustDitherLit(x, y)) found = DUST_SPARSE;
    }
  }
  return found;
};
