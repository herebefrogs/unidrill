import { isKeyDown, anyKeyDown, isKeyUp } from './inputs/keyboard';
import { isPointerDown, isPointerUp, pointerCanvasPosition, pointerDirection } from './inputs/pointer';
import { isMobile } from './mobile';
import { checkMonetization, isMonetizationEnabled } from './monetization';
import { share } from './share';
import { loadSongs, playSound, playSong } from './sound';
import { initSpeech } from './speech';
import { save, load } from './storage';
import { ALIGN_LEFT, ALIGN_CENTER, ALIGN_RIGHT, CHARSET_SIZE, initCharset, renderText, initTextBuffer, clearTextBuffer, renderAnimatedText } from './text';
import { clamp, getRandSeed, setRandSeed, loadImg, lerp } from './utils';
import { CELL_SIZE, sampleMaterial, materialColor, MATERIAL_DRAG, sampleDust, DUST_NONE, DUST_DENSE } from './terrain';
import TILESET from '../img/tileset.webp';


const konamiCode = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA'];
let konamiIndex = 0;

// GAMEPLAY VARIABLES

const TITLE_SCREEN = 0;
const GAME_SCREEN = 1;
const END_SCREEN = 2;
let screen = GAME_SCREEN; // TODO restore TITLE_SCREEN once GAME_SCREEN is further along

// factor by which to reduce both velX and velY when player moving diagonally
// so they don't seem to move faster than when traveling vertically or horizontally
const NORMALIZE_DIAGONAL = Math.cos(Math.PI / 4);

const HERO_W = 28;                             // temporary blue square, real sprite later
const HERO_H = 28;
// how fast the drill rotates toward its 8-direction steering target
// (radians/sec). Finite so the heading eases into the new direction rather
// than snapping to one of 8 discrete angles - 4*PI = a full 180 in ~0.25s,
// 90 in ~0.125s: progressive but not laggy. Playtest knob; Infinity would
// give a classic instant snap.
const TURN_SPEED = 4 * Math.PI;

// momentum loop tuning (px/sec, px/sec^2). The drill launches with a fixed
// downward impulse (MOMENTUM.initial) that only ever decays: a baseline
// entropy plus drag from whatever the drill's leading edge is cutting
// through (MATERIAL_DRAG in terrain.js, or the cheaper tunnel/air values
// here for backtracking / breaching the surface). Dense-dust boosts will
// top it back up once dust exists.
const MOMENTUM = {
  initial: 620,               // launch impulse
  max: 620,                   // dense-dust boosts restore toward launch speed, never above - also keeps digShaft's per-frame circle contiguous (a faster drill would skip cells between frames)
  entropy: 35,                // material-independent decay, always applied underground
  tunnelDrag: 15,             // through an already-carved cell - cheap backtrack, not free
  airDrag: 0,                 // above the surface
  denseBoost: 30,             // px/sec added per dense-dust cell dug; digShaft clears several cells/tick so patch entry is a jolt (see DESIGN Open questions)
  winMinDepth: 6 * CELL_SIZE, // must have drilled at least this deep for a resurface to count as a win
};

let hero;
let heroWentDeep;                              // armed once depth passes MOMENTUM.winMinDepth; gates the resurface win
let outcome;                                   // true = win (rainbow), false = lose (bingo fuel); read on END_SCREEN
let endReady;                                  // END_SCREEN: true once all inputs held at game-over have been released
let depth;                                     // px drilled below the surface (world-space y, until infinite scroll lands)
let dust;                                       // rainbow-dust cells collected this run (= DUG ∩ sampleDust), tallied when its particle lands on the counter (or instantly if the run ends first, see endGame()).
let particles;                                  // in-flight collection particles (screen-space); each carries the one dust point it's still owed until it lands or endGame() tallies it early

let speak;

// RENDER VARIABLES

let cameraX = 0;                        // camera/viewport position in map
let cameraY = 0;
const CAMERA_WIDTH = 1280;              // camera/viewport size
const CAMERA_HEIGHT = 960;
const SURFACE_Y = CAMERA_HEIGHT / 2;    // world y of ground level; hero starts here, underground gen starts below it
const SKY_COLOR = '#9fd8ff';
const TUNNEL_COLOR = '#000';            // dug-out cell below the surface line
// underground-y (SURFACE_Y-relative, see paintRow) that MAP buffer row 0
// currently represents; scrollMap() advances this as the buffer gets paged
let mapOffset = 0;
// cells dug out so far, keyed by 'x_undergroundY' (both CELL_SIZE-aligned).
// Set persists across scrolling so backtracking through a dug shaft doesn't
// regenerate solid material - see dig()/paintRow().
const DUG = new Set();

hero = {
  x: CAMERA_WIDTH / 2 - HERO_W / 2,
  y: SURFACE_Y - HERO_H,                // feet on the ground, not center
  w: HERO_W,
  h: HERO_H,
  angle: Math.PI / 2,                   // 0 = facing right (+x), PI/2 = facing down (+y)
  velX: 0,
  velY: 0,
  momentum: MOMENTUM.initial,
};
heroWentDeep = false;
depth = 0;
dust = 0;
particles = [];
// camera-window & edge-snapping settings
const CAMERA_WINDOW_X = 400;
const CAMERA_WINDOW_Y = 200;
const CAMERA_WINDOW_WIDTH = CAMERA_WIDTH - 2*CAMERA_WINDOW_X;
const CAMERA_WINDOW_HEIGHT = CAMERA_HEIGHT - 2*CAMERA_WINDOW_Y;

const CTX = c.getContext('2d');         // visible canvas
const BUFFER = c.cloneNode();           // backbuffer
const BUFFER_CTX = BUFFER.getContext('2d');
BUFFER.width = 2560;                    // backbuffer size
BUFFER.height = 1920;
const MAP = c.cloneNode();              // static elements of the map/world cached once
const MAP_CTX = MAP.getContext('2d');
MAP.width = 2560;                       // map size, same as backbuffer
MAP.height = 1920;
// dust-cell shapes only (opaque white on transparent), paged in lockstep
// with MAP by scrollMap(). Colour is applied per-frame in renderDust() by
// masking a drifting rainbow through these shapes - baking it into MAP
// wouldn't work, MAP freezes each row's colours as the buffer pages.
const DUST_MASK = c.cloneNode();
const DUST_MASK_CTX = DUST_MASK.getContext('2d');
DUST_MASK.width = 2560;
DUST_MASK.height = 1920;
// per-frame scratch: the camera slice of DUST_MASK, masked against
// DUST_GRADIENT (source-in), then composited onto BUFFER. Camera-sized, not
// buffer-sized - only the visible slice is ever coloured.
const DUST_LAYER = c.cloneNode();
const DUST_LAYER_CTX = DUST_LAYER.getContext('2d');
DUST_LAYER.width = CAMERA_WIDTH;
DUST_LAYER.height = CAMERA_HEIGHT;
// dust colour comes from a repeating diagonal rainbow (top-left -> bottom-
// right) that the dust mask samples. It is anchored to UNDERGROUND position
// (renderDust offsets it by the camera's underground origin) plus a steady
// time-driven phase, so the rainbow drifts across the terrain at a constant
// rate that is independent of how fast the player is descending. Banded, not
// smooth - steps through DUST_PALETTE. Hand-picked hex, not computed from
// HSL, so each swatch can be nudged on its own; kept a touch muted (esp.
// yellow) so no band flares. The 7 rainbow colours, no blends.
const DUST_BAND = 40;                   // px along the diagonal per colour band
const DUST_SPEED = 56;                  // px/sec the rainbow drifts (constant, not tied to descent). A divisor of DUST_P (280): a point cycles the full palette in a round 5s and the phase wraps exactly on a band boundary.
const DUST_PALETTE = [
  '#e0403a', // red
  '#d97b32', // orange
  '#be9a38', // yellow
  '#55913f', // green
  '#3f77b8', // blue
  '#4b52a8', // indigo
  '#8450b4', // violet
];
// bake one seamless tile of the diagonal rainbow, used as a repeating
// pattern. The tile is DUST_P square - an exact whole number of colour bands
// each way - so f(x+y) is periodic across the edges and 'repeat' shows no
// seam. Rotate the context 45deg and lay down vertical stripes: in tile
// space they become bands of constant (x+y), i.e. the ↘ gradient.
const DUST_P = DUST_BAND * DUST_PALETTE.length;
const DUST_GRADIENT = c.cloneNode();
DUST_GRADIENT.width = DUST_GRADIENT.height = DUST_P;
{
  const g = DUST_GRADIENT.getContext('2d');
  const L = DUST_PALETTE.length;
  const sw = DUST_BAND / Math.SQRT2;             // stripe width in the rotated frame
  const span = DUST_P * 2;                       // > the rotated tile's diagonal reach
  g.translate(DUST_P / 2, DUST_P / 2);
  g.rotate(Math.PI / 4);
  for (let i = -Math.ceil(span / sw); i <= Math.ceil(span / sw); i++) {
    g.fillStyle = DUST_PALETTE[((i % L) + L) % L];
    g.fillRect(Math.floor(i * sw), -span, Math.ceil(sw) + 1, 2 * span);  // +1: overlap, kills hairline seams
  }
}
const DUST_PATTERN = DUST_LAYER_CTX.createPattern(DUST_GRADIENT, 'repeat');

// collection animation: a dug dust cell detaches in two stages, and its
// dust point is only tallied when it lands (see `dust`, updateParticles()) -
// unless the run ends first, in which case endGame() tallies whatever's
// still in flight instantly so score doesn't depend on animation timing.
// Stage 0 ("takeoff"): the cell doubles in size in place, at its
// dig location - tracked in BUFFER/world space like the hero, so it rides
// the camera scroll exactly like the terrain it detached from (including
// scrollMap's paging jumps, see the particle loop there). Stage 1
// ("flight"): eases (accelerating from rest) to the HUD dust counter -
// switches to SCREEN space (camera-independent) at the stage transition,
// because the camera re-centers on the hero every frame, so a particle
// still tracked in buffer space would drift away from the (screen-fixed)
// counter instead of flying to it. Both stages draw onto BUFFER_CTX -
// stage 0 directly in buffer coordinates, stage 1 by adding back the
// *current* camera position each frame (see renderParticles) - keeping
// particles on the animation layer (over MAP/dust, under HUD) per
// DESIGN.md.
const PARTICLE_SIZE = CELL_SIZE;
const PARTICLE_PUSH_MARGIN = CELL_SIZE * 3;   // how far stage 0 clears the tunnel edge by - bigger spreads a dense patch's many-particles-at-once apart
const PARTICLE_GROW_DURATION = 0.25;    // seconds, stage 0: growing in place
const PARTICLE_FLY_DURATION = 0.6;      // seconds, stage 1: flight to the counter
const PARTICLE_DURATION_JITTER = 0.2;   // +/- range, staggers arrivals on a multi-cell dig
const DUST_COUNTER_X = CAMERA_WIDTH - CHARSET_SIZE;   // where the HUD 'dust N' label is drawn (also the particles' flight target)
const DUST_COUNTER_Y = 3 * CHARSET_SIZE + 8;

const TEXT = initTextBuffer(c, CAMERA_WIDTH, CAMERA_HEIGHT);  // text buffer


const ATLAS = {};
const FRAME_DURATION = 0.1; // duration of 1 animation frame, in seconds
let tileset;   // characters sprite, embedded as a base64 encoded dataurl by build script

// LOOP VARIABLES

let currentTime;
let elapsedTime;
let lastTime;
let requestId;
// elapsed GAME time (seconds), unlike currentTime/performance.now() which
// keeps ticking wall-clock time through a pause - only ever advanced by
// elapsedTime inside loop()'s `running` guard, so pausing just freezes it.
// Anything animating off the passage of time during gameplay (the dust
// rainbow phase) must key off this, not currentTime, or the wall-clock gap
// while paused shows up as a jump on resume.
let gameTime = 0;
let running = true;

// GAMEPLAY HANDLERS

function unlockExtraContent() {
  // NOTE: remember to update the value of the monetization meta tag in src/index.html to your payment pointer
}

function startGame() {
  // setRandSeed(getRandSeed());
  // if (isMonetizationEnabled()) { unlockExtraContent() }
  konamiIndex = 0;
  cameraX = cameraY = 0;
  mapOffset = 0;
  DUG.clear();
  hero = {
    x: CAMERA_WIDTH / 2 - HERO_W / 2,
    y: SURFACE_Y - HERO_H,          // feet on the ground, not center
    w: HERO_W,
    h: HERO_H,
    angle: Math.PI / 2,              // 0 = facing right (+x), PI/2 = facing down (+y)
    velX: 0,
    velY: 0,
    momentum: MOMENTUM.initial,
  };
  heroWentDeep = false;
  outcome = undefined;
  depth = 0;
  dust = 0;
  particles = [];
  renderMap();
  screen = GAME_SCREEN;
};

function testAABBCollision(entity1, entity2) {
  const test = {
    entity1MaxX: entity1.x + entity1.w,
    entity1MaxY: entity1.y + entity1.h,
    entity2MaxX: entity2.x + entity2.w,
    entity2MaxY: entity2.y + entity2.h,
  };

  test.collide = entity1.x < test.entity2MaxX
    && test.entity1MaxX > entity2.x
    && entity1.y < test.entity2MaxY
    && test.entity1MaxY > entity2.y;

  return test;
};

// entity1 collided into entity2
function correctAABBCollision(entity1, entity2, test) {
  const { entity1MaxX, entity1MaxY, entity2MaxX, entity2MaxY } = test;

  const deltaMaxX = entity1MaxX - entity2.x;
  const deltaMaxY = entity1MaxY - entity2.y;
  const deltaMinX = entity2MaxX - entity1.x;
  const deltaMinY = entity2MaxY - entity1.y;

  // AABB collision response (homegrown wall sliding, not physically correct
  // because just pushing along one axis by the distance overlapped)

  // entity1 moving down/right
  if (entity1.velX > 0 && entity1.velY > 0) {
    if (deltaMaxX < deltaMaxY) {
      // collided right side first
      entity1.x -= deltaMaxX;
    } else {
      // collided top side first
      entity1.y -= deltaMaxY;
    }
  }
  // entity1 moving up/right
  else if (entity1.velX > 0 && entity1.velY < 0) {
    if (deltaMaxX < deltaMinY) {
      // collided right side first
      entity1.x -= deltaMaxX;
    } else {
      // collided bottom side first
      entity1.y += deltaMinY;
    }
  }
  // entity1 moving right
  else if (entity1.velX > 0) {
    entity1.x -= deltaMaxX;
  }
  // entity1 moving down/left
  else if (entity1.velX < 0 && entity1.velY > 0) {
    if (deltaMinX < deltaMaxY) {
      // collided left side first
      entity1.x += deltaMinX;
    } else {
      // collided top side first
      entity1.y -= deltaMaxY;
    }
  }
  // entity1 moving up/left
  else if (entity1.velX < 0 && entity1.velY < 0) {
    if (deltaMinX < deltaMinY) {
      // collided left side first
      entity1.x += deltaMinX;
    } else {
      // collided bottom side first
      entity1.y += deltaMinY;
    }
  }
  // entity1 moving left
  else if (entity1.velX < 0) {
    entity1.x += deltaMinX;
  }
  // entity1 moving down
  else if (entity1.velY > 0) {
    entity1.y -= deltaMaxY;
  }
  // entity1 moving up
  else if (entity1.velY < 0) {
    entity1.y += deltaMinY;
  }
};

function constrainToViewport(entity) {
  if (entity.x < 0) {
    entity.x = 0;
  } else if (entity.x > MAP.width - entity.w) {
    entity.x = MAP.width - entity.w;
  }
  if (entity.y < 0) {
    entity.y = 0;
  } else if (entity.y > MAP.height - entity.h) {
    entity.y = MAP.height - entity.h;
  }
};


function updateCameraWindow() {
  // TODO try to simplify the formulae below with this variable so it's easier to visualize
  // const cameraEdgeLeftX = cameraX + CAMERA_WINDOW_X;
  // const cameraEdgeTopY = cameraY + CAMERA_WINDOW_Y;
  // const cameraEdgeRightX = cameraEdgeLeftX + CAMERA_WINDOW_WIDTH;
  // const cameraEdgeBottomY = cameraEdgeTopY + CAMERA_WINDOW_HEIGHT;

  // edge snapping
  if (0 < cameraX && hero.x < cameraX + CAMERA_WINDOW_X) {
    cameraX = Math.max(0, hero.x - CAMERA_WINDOW_X);
  }
  else if (cameraX + CAMERA_WINDOW_X + CAMERA_WINDOW_WIDTH < MAP.width && hero.x + hero.w > cameraX + CAMERA_WINDOW_X + CAMERA_WINDOW_WIDTH) {
    cameraX = Math.min(MAP.width - CAMERA_WIDTH, hero.x + hero.w - (CAMERA_WINDOW_X + CAMERA_WINDOW_WIDTH));
  }
  if (0 < cameraY && hero.y < cameraY + CAMERA_WINDOW_Y) {
    cameraY = Math.max(0, hero.y - CAMERA_WINDOW_Y);
  }
  else if (cameraY + CAMERA_WINDOW_Y + CAMERA_WINDOW_HEIGHT < MAP.height && hero.y + hero.h > cameraY + CAMERA_WINDOW_Y + CAMERA_WINDOW_HEIGHT) {
    cameraY = Math.min(MAP.height - CAMERA_HEIGHT, hero.y + hero.h - (CAMERA_WINDOW_Y + CAMERA_WINDOW_HEIGHT));
  }
};

// TODO move to utils (or dedicated utils package)
function velocityForTarget(srcX, srcY, destX, destY) {
  const hypotenuse = Math.hypot(destX - srcX, destY - srcY)
  const adjacent = destX - srcX;
  const opposite = destY - srcY;
  // [
  //  velX = cos(alpha),
  //  velY = sin(alpha),
  //  alpha (TODO is zero at the top?)
  // ]
  return [
    adjacent / hypotenuse,
    opposite / hypotenuse,
    Math.atan2(opposite / hypotenuse, adjacent / hypotenuse) + Math.PI/2,
  ];
}

// TODO move to utils (or dedicated utils package)
function positionOnCircle(centerX, centerY, radius, angle) {
  return [
    centerX + radius * Math.cos(angle),
    centerY + radius * Math.sin(angle)
  ];
}

function createEntity(type, x = 0, y = 0) {
  const action = 'move';
  const sprite = ATLAS[type][action][0];
  return {
    action,
    frame: 0,
    frameTime: 0,
    h: sprite.h,
    moveDown: 0,
    moveLeft: 0,
    moveRight: 0,
    moveUp: 0,
    velX: 0,
    velY: 0,
    speed: ATLAS[type].speed,
    type,
    w: sprite.w,
    x,
    y,
  };
};

function updateEntity(entity) {
  // update animation frame
  entity.frameTime += elapsedTime;
  if (entity.frameTime > FRAME_DURATION) {
    entity.frameTime -= FRAME_DURATION;
    entity.frame += 1;
    entity.frame %= ATLAS[entity.type][entity.action].length;
  }
  // update position
  const scale = entity.velX && entity.velY ? NORMALIZE_DIAGONAL : 1;
  const distance = entity.speed * elapsedTime * scale;
  entity.x += distance * entity.velX;
  entity.y += distance * entity.velY;
};

const pointerMapPosition = () => {
  const [x, y] = pointerCanvasPosition(c.width, c.height);
  return [x*CAMERA_WIDTH/c.width + cameraX, y*CAMERA_HEIGHT/c.height + cameraY].map(Math.round);
}

function processInputs() {
  switch (screen) {
    case TITLE_SCREEN:
      if (isKeyUp(konamiCode[konamiIndex])) {
        konamiIndex++;
      }
      if (anyKeyDown() || isPointerUp()) {
        startGame();
      }
      break;
    case GAME_SCREEN: {
      // steering only, no throttle: the drill always thrusts forward along
      // hero.angle (see moveHero). Both input paths pick an ABSOLUTE target
      // heading - Up is up on the descent AND the climb, no bank-model
      // inversion - then hero.angle rotates toward it at TURN_SPEED.
      let target;
      if (isPointerDown()) {
        const [vX, vY] = pointerDirection();
        if (vX || vY) target = Math.atan2(vY, vX);
      } else {
        // e.code is physical: AZERTY's ZQSD sits on physical KeyW/KeyQ/KeyS/
        // KeyD, so KeyW/KeyS already serve both layouts; only left needs KeyQ.
        const dx = (isKeyDown('ArrowRight', 'KeyD') ? 1 : 0)
                 - (isKeyDown('ArrowLeft', 'KeyA', 'KeyQ') ? 1 : 0);
        const dy = (isKeyDown('ArrowDown', 'KeyS') ? 1 : 0)
                 - (isKeyDown('ArrowUp', 'KeyW') ? 1 : 0);
        if (dx || dy) target = Math.atan2(dy, dx);
      }
      // nothing held -> coast on the current heading (momentum game, no neutral)
      if (target !== undefined) {
        // shortest signed turn to the target, wrapped to [-PI, PI] so a 180
        // press doesn't pick the long way round
        const d = Math.atan2(Math.sin(target - hero.angle), Math.cos(target - hero.angle));
        const step = TURN_SPEED * elapsedTime;   // Infinity => clamp is a no-op => snap
        hero.angle += clamp(d, -step, step);
      }
      break;
    }
    case END_SCREEN:
      if (isKeyUp('KeyT')) {
        // TODO can I share an image of the game?
        share({
          title: document.title,
          text: 'Check this game template made by @herebefrogs',
          url: 'https://bit.ly/gmjblp'
        });
      }
      // wait for every key/pointer held when the run ended to be released
      // first, then a fresh press restarts - otherwise a steering key still
      // down at the moment momentum ran out restarts instantly. (temporary:
      // straight back into a new run, no title screen.)
      if (!anyKeyDown() && !isPointerDown()) endReady = true;
      if (endReady && (anyKeyDown() || isPointerUp())) startGame();
      break;
  }
}

function update() {
  processInputs();

  if (screen === GAME_SCREEN) {
    moveHero();
    // moveHero() may have ended the run this frame (bingo fuel / resurface
    // win); don't dig - a post-mortem dig would still tally dust and top up
    // momentum after game-over.
    if (screen === GAME_SCREEN) {
      digShaft();
      followCamera();
    }
  }
  // outside the GAME_SCREEN guard: particles in flight when the run ends
  // still finish flying on END_SCREEN instead of freezing mid-air.
  updateParticles();
};

// deceleration (px/sec^2) the drill currently suffers, sampled at its
// leading edge (one drill-radius + one cell ahead of centre along the
// heading - the centre's own cell is dug out most frames, so sampling
// there would read "tunnel" while cutting virgin ground). Mirrors
// paintRow()'s lookup order - sky, then already-dug tunnel, then virgin
// material - so backtracking up your own shaft is cheap but drilling fresh
// clay is punishing.
function currentDrag() {
  const r = hero.w / 2;
  const ex = hero.x + hero.w / 2 + Math.cos(hero.angle) * (r + CELL_SIZE);
  const ey = hero.y + hero.h / 2 + Math.sin(hero.angle) * (r + CELL_SIZE) - SURFACE_Y + mapOffset;
  if (ey < 0) return MOMENTUM.airDrag;
  const key = Math.floor(ex / CELL_SIZE) * CELL_SIZE + '_' + Math.floor(ey / CELL_SIZE) * CELL_SIZE;
  return MOMENTUM.entropy + (DUG.has(key) ? MOMENTUM.tunnelDrag : MATERIAL_DRAG[sampleMaterial(ex, ey)]);
}

function moveHero() {
  // forward thrust along hero.angle at a speed that is finite, decaying
  // momentum - no throttle, steering only (see processInputs). Drag comes
  // from whatever the drill's leading edge is cutting through.
  hero.momentum = Math.max(0, hero.momentum - currentDrag() * elapsedTime);
  hero.velX = Math.cos(hero.angle);
  hero.velY = Math.sin(hero.angle);
  hero.x += hero.velX * hero.momentum * elapsedTime;
  hero.y += hero.velY * hero.momentum * elapsedTime;
  // temporary: clamp to the (currently x-locked) camera width instead of the
  // full map width - there's no horizontal camera panning yet, and proper
  // edge collision is TODO item 6, this just stops the hero drilling off
  // both sides of the visible viewport.
  hero.x = Math.max(0, Math.min(CAMERA_WIDTH - hero.w, hero.x));
  depth = Math.max(0, Math.round(hero.y + hero.h - SURFACE_Y + mapOffset));

  if (depth >= MOMENTUM.winMinDepth) heroWentDeep = true;
  // win: back at the surface with momentum still to spare, after a real dive.
  if (heroWentDeep && depth <= 0 && hero.momentum > 0) return endGame(true);
  // lose: momentum ran out while still underground ("bingo fuel").
  if (hero.momentum <= 0) return endGame(false);
}

function endGame(won) {
  // the run can end (surfacing or bingo fuel) while particles are still
  // mid-flight; tally their dust immediately instead of leaving the score
  // dependent on how much of that cosmetic animation had time to finish.
  // They're left in `particles` (marked counted) so they still finish
  // flying visually on END_SCREEN.
  for (const p of particles) if (!p.counted) { dust++; p.counted = true; }
  outcome = won;
  endReady = false;
  screen = END_SCREEN;
}

// stamps a fixed-radius circle around the hero's center every frame (per
// DESIGN.md: fixed-width tunnel, not variable). An axis-aligned box would've
// carved a fatter tunnel on diagonals than straight down/up.
function digShaft() {
  const cx = hero.x + hero.w / 2;
  const cy = hero.y + hero.h / 2 - SURFACE_Y + mapOffset;   // underground-space
  const r = hero.w / 2;
  for (let x = Math.floor((cx - r) / CELL_SIZE) * CELL_SIZE; x < cx + r; x += CELL_SIZE) {
    for (let y = Math.max(0, Math.floor((cy - r) / CELL_SIZE) * CELL_SIZE); y < cy + r; y += CELL_SIZE) {
      if (Math.hypot(x + CELL_SIZE / 2 - cx, y + CELL_SIZE / 2 - cy) <= r) dig(x, y);
    }
  }
}

// mark one CELL_SIZE cell as dug (x, undergroundY both CELL_SIZE-aligned) and
// punch the hole into the MAP buffer right away. paintRow() also consults
// DUG so a previously dug cell stays dug after scrolling away and back.
function dig(x, undergroundY) {
  const key = x + '_' + undergroundY;
  if (!DUG.has(key)) {
    DUG.add(key);
    MAP_CTX.fillStyle = TUNNEL_COLOR;
    MAP_CTX.fillRect(x, undergroundY + SURFACE_Y - mapOffset, CELL_SIZE, CELL_SIZE);
    // stop this cell shimmering now it's collected; paintRow()'s !dug check
    // keeps it clear when the row pages away and back
    DUST_MASK_CTX.clearRect(x, undergroundY + SURFACE_Y - mapOffset, CELL_SIZE, CELL_SIZE);
    // collection = DUG ∩ sampleDust, so a cell counts the first (only) time
    // it's dug. +1 per cell regardless of category - "dense yields more" is
    // already delivered by dense patches being solid vs sparse's ~25% mask.
    // Dense cells also top momentum back up (per-cell; digShaft clears a few
    // at once, so patch entry gives a jolt). The +1 itself isn't tallied
    // here - spawnDustParticle()'s particle carries it until it lands (or
    // the run ends, see endGame()).
    const d = sampleDust(x, undergroundY);
    if (d !== DUST_NONE) {
      spawnDustParticle(x, undergroundY);
      if (d === DUST_DENSE) hero.momentum = Math.min(MOMENTUM.max, hero.momentum + MOMENTUM.denseBoost);
    }
  }
}

// colour a dust cell would render as right now, without reading pixels back
// from DUST_LAYER: renderDust() masks DUST_PATTERN through DUST_MASK, and
// DUST_PATTERN tiles DUST_GRADIENT (rotate-45+stripe bands, see its build
// above) offset by the camera's underground origin + a time phase. Working
// through both transforms algebraically, the on-screen band index at a given
// (worldX, undergroundY) reduces to this one expression - the 45deg rotation
// and the tile's recentring translate both cancel out. Sampled at the cell
// CENTRE (x, y already CELL_SIZE-aligned) so a cell straddling a band
// boundary doesn't pick its neighbour's colour.
function dustColorAt(x, undergroundY) {
  const phase = Math.floor(gameTime * DUST_SPEED);
  const i = Math.floor((x + CELL_SIZE / 2 + undergroundY + CELL_SIZE / 2 + phase) / DUST_BAND);
  return DUST_PALETTE[((i % DUST_PALETTE.length) + DUST_PALETTE.length) % DUST_PALETTE.length];
}

// spawn one collection particle for a just-dug dust cell, starting stage 0
// ("takeoff") at the cell's centre in BUFFER/world space.
function spawnDustParticle(x, undergroundY) {
  const cx = x + CELL_SIZE / 2;
  const cy = undergroundY + SURFACE_Y - mapOffset + CELL_SIZE / 2;
  // push radially out from the hero (the tunnel's centre) while growing, so
  // the particle clears the freshly-dug (black) tunnel instead of doubling
  // in size on top of it. dist is always <= hero.w/2 - digShaft only calls
  // dig() for cells within that radius - so the push is never negative.
  const hx = hero.x + hero.w / 2, hy = hero.y + hero.h / 2;
  const dist = Math.hypot(cx - hx, cy - hy) || 1;
  const push = (hero.w / 2 - dist) + PARTICLE_PUSH_MARGIN;
  particles.push({
    x: cx,
    y: cy,
    pushX: (cx - hx) / dist * push,
    pushY: (cy - hy) / dist * push,
    stage: 0,
    t: 0,
    growDuration: PARTICLE_GROW_DURATION + (Math.random() - 0.5) * PARTICLE_DURATION_JITTER,
    flyDuration: PARTICLE_FLY_DURATION + (Math.random() - 0.5) * PARTICLE_DURATION_JITTER,
    color: dustColorAt(x, undergroundY),
    counted: false,   // set once its dust point has been tallied, by landing or by endGame() - guards against double-counting when both can happen
  });
}

// advance particles, tally the ones that land, and drop them. Runs every
// frame regardless of screen (see call site in update()) so a dig right
// before game-over still finishes its animation on END_SCREEN instead of
// freezing mid-air.
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += elapsedTime;
    if (p.stage === 0) {
      if (p.t >= p.growDuration) {
        // stage transition: snapshot the fully-grown, fully-pushed screen
        // position as the stage-1 flight's start point (see the PARTICLE_*
        // comment) and carry over the leftover time so the switch doesn't
        // stutter.
        p.t -= p.growDuration;
        p.stage = 1;
        p.x0 = p.x + p.pushX - cameraX;
        p.y0 = p.y + p.pushY - cameraY;
      }
    } else if (p.t >= p.flyDuration) {
      if (!p.counted) dust++;
      particles.splice(i, 1);
    }
  }
}

// kept as its own step, decoupled from moveHero(): the camera only ever
// reads hero.y, it never feeds back into hero's own position. This is
// still a temporary hard lock - smoothing/lookahead is TODO.md's last item.
function followCamera() {
  cameraY = hero.y + hero.h / 2 - CAMERA_HEIGHT / 2;
  // once the camera drifts past the buffer's edge, page the buffer instead
  // of clamping: shift its content, patch the newly exposed strip, and
  // re-center in one jump (rather than paging every single frame) using
  // the existing 2x buffer-vs-camera size as lookahead margin.
  if (cameraY < 0 || cameraY > MAP.height - CAMERA_HEIGHT) {
    const margin = (MAP.height - CAMERA_HEIGHT) / 2;
    scrollMap(Math.round((cameraY - margin) / CELL_SIZE) * CELL_SIZE);
  }
}

// self-blit the MAP buffer by dy px (+down/-up) and patch only the newly
// exposed strip, instead of resampling every visible pixel every frame.
// Keeps hero/camera pointing at the same underground spot they were before.
function scrollMap(dy) {
  if (!dy) return;
  // 'copy' so the (partly transparent) dust mask overwrites itself cleanly on
  // the self-blit - source-over would leave the old dust showing through the
  // gaps. It also wipes the newly-exposed strip to transparent, which the
  // paintRow() calls below then restamp.
  if (dy > 0) {
    MAP_CTX.drawImage(MAP, 0, dy, MAP.width, MAP.height - dy, 0, 0, MAP.width, MAP.height - dy);
    DUST_MASK_CTX.globalCompositeOperation = 'copy';
    DUST_MASK_CTX.drawImage(DUST_MASK, 0, dy, MAP.width, MAP.height - dy, 0, 0, MAP.width, MAP.height - dy);
    DUST_MASK_CTX.globalCompositeOperation = 'source-over';
    mapOffset += dy;
    for (let y = MAP.height - dy; y < MAP.height; y += CELL_SIZE) paintRow(y);
  } else {
    MAP_CTX.drawImage(MAP, 0, 0, MAP.width, MAP.height + dy, 0, -dy, MAP.width, MAP.height + dy);
    DUST_MASK_CTX.globalCompositeOperation = 'copy';
    DUST_MASK_CTX.drawImage(DUST_MASK, 0, 0, MAP.width, MAP.height + dy, 0, -dy, MAP.width, MAP.height + dy);
    DUST_MASK_CTX.globalCompositeOperation = 'source-over';
    mapOffset += dy;
    for (let y = 0; y < -dy; y += CELL_SIZE) paintRow(y);
  }
  hero.y -= dy;
  cameraY -= dy;
  // stage-0 particles are buffer/world-space, same as hero.y - keep them
  // glued to their dig position through the self-blit jump (stage-1 ones
  // are already screen-space and need no correction).
  for (const p of particles) if (p.stage === 0) p.y -= dy;
}

// RENDER HANDLERS

function blit() {
  // copy camera portion of the backbuffer onto visible canvas, scaling it to screen dimensions
  CTX.drawImage(
    BUFFER,
    cameraX, cameraY, CAMERA_WIDTH, CAMERA_HEIGHT,
    0, 0, c.width, c.height
  );
  CTX.drawImage(
    TEXT,
    0, 0, CAMERA_WIDTH, CAMERA_HEIGHT,
    0, 0, c.width, c.height
  );
};

function render() {
  clearTextBuffer();

  switch (screen) {
    case TITLE_SCREEN:
      BUFFER_CTX.drawImage(MAP, 0, 0, BUFFER.width, BUFFER.height);
      renderText('title screen', CHARSET_SIZE, CHARSET_SIZE);
      renderText(isMobile ? 'tap to start' : 'press any key', CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2, ALIGN_CENTER);
      if (konamiIndex === konamiCode.length) {
        renderText('konami mode on', BUFFER.width - CHARSET_SIZE, CHARSET_SIZE, ALIGN_RIGHT);
      }
      break;
    case GAME_SCREEN:
      // clear backbuffer by drawing static map elements
      // TODO could also just draw the camera visible portion of the map
      BUFFER_CTX.drawImage(MAP, 0, 0, BUFFER.width, BUFFER.height);
      renderDust();
      renderParticles();
      BUFFER_CTX.fillStyle = '#2255ee';
      BUFFER_CTX.fillRect(hero.x, hero.y, hero.w, hero.h);
      renderText('game screen', CHARSET_SIZE, CHARSET_SIZE);
      renderText('depth ' + depth, CAMERA_WIDTH - CHARSET_SIZE, CHARSET_SIZE, ALIGN_RIGHT);
      renderText('momentum ' + Math.round(hero.momentum), CAMERA_WIDTH - CHARSET_SIZE, 2 * CHARSET_SIZE + 4, ALIGN_RIGHT);
      renderText('dust ' + dust, DUST_COUNTER_X, DUST_COUNTER_Y, ALIGN_RIGHT);
      // debugCameraWindow();
      // uncomment to debug mobile input handlers
      // renderDebugTouch();
      break;
    case END_SCREEN:
      // keep the map + last hero position on screen (less jarring than a
      // flat wipe, and the player sees where they ran out); just overlay
      // the outcome text.
      BUFFER_CTX.drawImage(MAP, 0, 0, BUFFER.width, BUFFER.height);
      renderDust();
      renderParticles();
      BUFFER_CTX.fillStyle = '#2255ee';
      BUFFER_CTX.fillRect(hero.x, hero.y, hero.w, hero.h);
      renderText(outcome ? 'rainbow!' : 'out of momentum', CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2, ALIGN_CENTER);
      renderText('depth ' + depth, CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2 + 2 * CHARSET_SIZE, ALIGN_CENTER);
      renderText('dust ' + dust, CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2 + 3 * CHARSET_SIZE, ALIGN_CENTER);
      if (endReady) renderText(isMobile ? 'tap to retry' : 'press any key', CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2 + 4 * CHARSET_SIZE, ALIGN_CENTER);
      // renderText(monetizationEarned(), TEXT.width - CHARSET_SIZE, TEXT.height - 2*CHARSET_SIZE, ALIGN_RIGHT);
      break;
  }

  blit();
};

// dust colour layer: lift the camera slice of DUST_MASK, colour it by masking
// the diagonal rainbow through it, composite over BUFFER between the MAP blit
// and the hero. Fixed cost regardless of how much dust is on screen - 2
// camera-sized drawImages + 1 pattern fill, no per-cell work (that all
// happened at paint time).
function renderDust() {
  // integer-align the camera rect: dust takes an extra round trip the MAP
  // blit doesn't (lift to (0,0), colour, place back), so a fractional cameraY
  // would snap differently on each hop and the dust would crawl ±1px against
  // the terrain as you scroll. Same int on lift and place = exact world pos.
  const cx = Math.floor(cameraX), cy = Math.floor(cameraY);
  // 'copy': lift the visible slice of the mask, discarding last frame
  DUST_LAYER_CTX.globalCompositeOperation = 'copy';
  DUST_LAYER_CTX.drawImage(DUST_MASK, cx, cy, CAMERA_WIDTH, CAMERA_HEIGHT, 0, 0, CAMERA_WIDTH, CAMERA_HEIGHT);
  // 'source-in': keep the rainbow only where the mask is opaque. The pattern
  // is offset by the camera's UNDERGROUND origin (mod tile size) so it tracks
  // the terrain, plus a steady time phase so it also drifts at a constant
  // rate. Underground y of scratch row 0 is (cy - SURFACE_Y + mapOffset), x
  // is cx. Phase is floored to whole px - integer offsets keep the pattern
  // pixel-aligned (smoothing is off), so it scrolls in crisp 1px steps.
  const phase = Math.floor(gameTime * DUST_SPEED);
  const tx = -(((cx % DUST_P) + DUST_P) % DUST_P);
  const ty = -((((cy - SURFACE_Y + mapOffset + phase) % DUST_P) + DUST_P) % DUST_P);
  DUST_LAYER_CTX.globalCompositeOperation = 'source-in';
  DUST_LAYER_CTX.fillStyle = DUST_PATTERN;
  DUST_LAYER_CTX.save();
  DUST_LAYER_CTX.translate(tx, ty);
  DUST_LAYER_CTX.fillRect(-tx, -ty, CAMERA_WIDTH, CAMERA_HEIGHT);
  DUST_LAYER_CTX.restore();
  DUST_LAYER_CTX.globalCompositeOperation = 'source-over';
  BUFFER_CTX.drawImage(DUST_LAYER, 0, 0, CAMERA_WIDTH, CAMERA_HEIGHT, cx, cy, CAMERA_WIDTH, CAMERA_HEIGHT);
};

// draw in-flight collection particles, easing (accelerating from rest) from
// their spawn point toward the HUD dust counter. Particles are stored in
// screen space (see spawnDustParticle), so re-adding the CURRENT camera
// position here is what keeps a screen-fixed target correct every frame
// despite the camera moving under them - and drawing onto BUFFER_CTX (not
// TEXT) keeps them on the animation layer, under the HUD, per DESIGN.md.
function renderParticles() {
  for (const p of particles) {
    let x, y, size;
    if (p.stage === 0) {
      // ease-out: grows fast then settles, reads as a "pop" toward the
      // camera; pushX/pushY ride along so it clears the tunnel it just left.
      const ease = 1 - (1 - Math.min(1, p.t / p.growDuration)) ** 2;
      x = p.x + p.pushX * ease;
      y = p.y + p.pushY * ease;
      size = lerp(PARTICLE_SIZE, PARTICLE_SIZE * 2, ease);
    } else {
      const ease = Math.min(1, p.t / p.flyDuration) ** 2;    // ease-in: accelerating from rest
      x = lerp(p.x0, DUST_COUNTER_X, ease) + cameraX;
      y = lerp(p.y0, DUST_COUNTER_Y, ease) + cameraY;
      size = PARTICLE_SIZE * 2;
    }
    BUFFER_CTX.fillStyle = p.color;
    BUFFER_CTX.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  }
};

function renderEntity(entity, ctx = BUFFER_CTX) {
  const sprite = ATLAS[entity.type][entity.action][entity.frame];
  // TODO skip draw if image outside of visible canvas
  ctx.drawImage(
    tileset,
    sprite.x, sprite.y, sprite.w, sprite.h,
    Math.round(entity.x), Math.round(entity.y), sprite.w, sprite.h
  );
};

function debugCameraWindow() {
  BUFFER_CTX.strokeStyle = '#d00';
  BUFFER_CTX.lineWidth = 1;
  BUFFER_CTX.strokeRect(cameraX + CAMERA_WINDOW_X, cameraY + CAMERA_WINDOW_Y, CAMERA_WINDOW_WIDTH, CAMERA_WINDOW_HEIGHT);
};

// one CELL_SIZE-tall band of the MAP buffer, sky above ground / material
// below - shared by the initial full paint and scrollMap's incremental one
function paintRow(y) {
  const underground = y - SURFACE_Y + mapOffset;
  // dust rides its own transparent-backed buffer, so - unlike MAP, which
  // fills every cell opaquely - this strip must be cleared before restamping,
  // or scrolled-away dust ghosts back in. sampleDust category (SPARSE/DENSE)
  // is irrelevant to the render: yield difference is already carried by the
  // physical fill (dense = solid patch, sparse = ~25% dither), colour is one
  // shared cycling hue. Collected cells (DUG) are skipped so they stop
  // shimmering once dug, and stay skipped when this row pages back in.
  DUST_MASK_CTX.clearRect(0, y, MAP.width, CELL_SIZE);
  DUST_MASK_CTX.fillStyle = '#fff';
  for (let x = 0; x < MAP.width; x += CELL_SIZE) {
    const dug = DUG.has(x + '_' + underground);
    const color = underground < 0 ? SKY_COLOR : dug ? TUNNEL_COLOR : materialColor(sampleMaterial(x, underground));
    MAP_CTX.fillStyle = color;
    MAP_CTX.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    if (underground >= 0 && !dug && sampleDust(x, underground) !== DUST_NONE) {
      DUST_MASK_CTX.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }
};

function renderMap() {
  for (let y = 0; y < MAP.height; y += CELL_SIZE) paintRow(y);
};

// LOOP HANDLERS

function loop() {
  if (running) {
    requestId = requestAnimationFrame(loop);
    currentTime = performance.now();
    elapsedTime = (currentTime - lastTime) / 1000;
    gameTime += elapsedTime;
    update();
    render();
    lastTime = currentTime;
  }
};

function toggleLoop(value) {
  running = value;
  if (running) {
    lastTime = performance.now();
    loop();
  } else {
    cancelAnimationFrame(requestId);
  }
};

// EVENT HANDLERS

// the real "main" of the game
onload = async (e) => {
  document.title = 'UniDrill Corp';

  onresize();
  //checkMonetization();

  await initCharset();
  tileset = await loadImg(TILESET);
  // speak = await initSpeech();
  renderMap();

  toggleLoop(true);
};

onresize = onrotate = function() {
  // scale canvas to fit screen while maintaining aspect ratio
  scaleToFit = Math.min(innerWidth / BUFFER.width, innerHeight / BUFFER.height);
  c.width = BUFFER.width * scaleToFit;
  c.height = BUFFER.height * scaleToFit;

  // disable smoothing on image scaling
  CTX.imageSmoothingEnabled = MAP_CTX.imageSmoothingEnabled = BUFFER_CTX.imageSmoothingEnabled = DUST_MASK_CTX.imageSmoothingEnabled = DUST_LAYER_CTX.imageSmoothingEnabled = false;

  // fix key events not received on itch.io when game loads in full screen
  window.focus();
};

// UTILS

document.onvisibilitychange = function(e) {
  // pause loop and game timer when switching tabs
  toggleLoop(!e.target.hidden);
};

addEventListener('keydown', e => {
  if (!e.repeat && screen === GAME_SCREEN && e.code === 'KeyP') {
    // Pause game as soon as key is pressed
    toggleLoop(!running);
  }
})

