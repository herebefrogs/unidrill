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

// scatter one jittered blob (center + radius) per grid cell, deterministic
// from its coordinates; `salt` decorrelates independent blob fields (rock vs dust)
const blobAt = (gx, gy, cellSize, minRadius, maxRadius, salt) => ({
  x: (gx + hash2D(gx, gy + salt)) * cellSize,
  y: (gy + hash2D(gx + salt, gy)) * cellSize,
  r: minRadius + hash2D(gx + salt, gy + salt) * (maxRadius - minRadius),
});

// how deep inside the nearest blob (x,y) falls: 0 at/outside its edge, 1 at its
// center. Scans the surrounding grid cells since a blob can spill into its
// neighbors. Overlapping blobs merge into bigger, irregular rounded clusters.
const blobField = (x, y, cellSize, minRadius, maxRadius, salt) => {
  const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize);
  let best = 0;
  for (let ny = gy - 1; ny <= gy + 1; ny++) {
    for (let nx = gx - 1; nx <= gx + 1; nx++) {
      const b = blobAt(nx, ny, cellSize, minRadius, maxRadius, salt);
      const depth = 1 - Math.hypot(x - b.x, y - b.y) / b.r;
      if (depth > best) best = depth;
    }
  }
  return best;
};

const ROCK_CELL = 120; // px per grid cell: one candidate boulder per cell
const ROCK_MIN_R = 24;
const ROCK_MAX_R = 56;

export const sampleMaterial = (x, y) => blobField(x, y, ROCK_CELL, ROCK_MIN_R, ROCK_MAX_R, 0) > 0 ? CLAY : SAND;

const DUST_CELL = 90;
const DUST_MIN_R = 16;
const DUST_MAX_R = 40;

// how deep inside the nearest dust blob this cell is: 1 at the core, fading to 0 at the edge
const dustDepth = (x, y) => blobField(x, y, DUST_CELL, DUST_MIN_R, DUST_MAX_R, 5000);

// ordered (Bayer) dithering: dense near a blob's core, sparse specks toward
// its edge, instead of a hard-edged solid fill
const BAYER4 = [
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
];

export const sampleDust = (x, y) => {
  const depth = dustDepth(x, y);
  if (depth <= 0) return false;
  const cx = Math.floor(x / CELL_SIZE) % 4;
  const cy = Math.floor(y / CELL_SIZE) % 4;
  return depth * 16 > BAYER4[cy * 4 + cx];
};

export const materialColor = type => MATERIAL_COLOR[type];

// hue tracks depth into the blob, so a patch reads as a coherent rainbow
// gradient from its core outward instead of per-cell confetti
export const dustColor = (x, y) => `hsl(${Math.floor(dustDepth(x, y) * 360) % 360},90%,60%)`;
