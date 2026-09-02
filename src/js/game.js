import { isKeyDown, anyKeyDown, isKeyUp, whichKeyDown } from './inputs/keyboard';
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
const REWIND_SCREEN = 2;   // run over: camera fast-walks the drilled path back up to the surface (see updateRewind), then -> END_SCREEN
const END_SCREEN = 3;
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
  initial: 600,               // launch impulse
  max: 600,                   // soft cap: the highest momentum ordinary drilling holds you at, and where an overspeed boost decays back to (see overBleed). HUD "full speed".
  overMax: 800,               // hard cap on the transient overshoot a dense patch can stack up (~1.33x max) - the kick is felt even when you enter a patch already at `max`. Ceiling stays under the digShaft limit (per-frame step < the drill diameter down to 30fps) so the carved tunnel never gets gaps.
  overBleed: 12,              // 1/sec: exponential rate the excess ABOVE `max` decays (on top of normal drag). ~0.08s time constant, so a boost surges then settles back to `max` in ~0.25s instead of becoming a new plateau. This is the "extra drag above the cap" that makes the two caps mean different things.
  entropy: 35,                // material-independent decay, always applied underground
  tunnelDrag: 15,             // through an already-carved cell - cheap backtrack, not free
  airDrag: 0,                 // above the surface
  denseBoost: 30,             // px/sec added per dense-dust cell dug; digShaft clears several cells/tick so patch entry is a jolt (see DESIGN Open questions)
  winMinDepth: 6 * CELL_SIZE, // must have drilled at least this deep for a resurface to count as a win
};

let hero;
let heroWentDeep;                              // armed once depth passes MOMENTUM.winMinDepth; gates the resurface win
let outcome;                                   // true = resurfaced with momentum to spare, false = momentum ran out underground; not surfaced to the player yet (END_SCREEN shows one neutral headline), kept for future share/highscore text
let endReady;                                  // END_SCREEN: true once all inputs held at game-over have been released
let endHeld;                                    // keys already down when END_SCREEN began (held over from gameplay / a rewind skip) - a press of anything NOT in here also restarts, so a leftover key doesn't lock the retry out (see processInputs END_SCREEN)
let depth;                                     // px below the surface right now (world-space y). Still drives heroWentDeep + the resurface end - just no longer the score or a HUD line (both axes drill infinitely, so absolute depth reads arbitrary); see tunnel.
let tunnel;                                     // px of virgin ground carved this run - accumulated in moveHero() while the drill's leading edge is cutting undug material (re-drilling an old shaft doesn't add). The scored "how far did you drill" measure; HUD "shaft".
let dust;                                       // rainbow-dust cells collected this run (= DUG ∩ sampleDust), tallied when its particle lands on the counter (or instantly if the run ends first, see endGame()).
let dustPop;                                     // gameTime of the last dust tally; drives the HUD counter's pop-and-shrink (see DUST_POP_DURATION)
let particles;                                  // in-flight collection particles (screen-space); each carries the one dust point it's still owed until it lands or endGame() tallies it early
let score;                                       // final run score, computed once in endGame() (after the early dust tally) = SCORE_PER_DUST*dust + metres of tunnel; shown on END_SCREEN
let rainbowX;                                     // world-x of the END_SCREEN rainbow's foot (ingress point, or egress point on a resurface); set in endGame()
let rainbowT;                                     // seconds accrued on END_SCREEN, drives the rainbow's grow sweep (see RAINBOW_GROW); reset in endGame(), advanced in update()
// breadcrumb polyline of the drill's path, flat [wx0, uy0, wx1, uy1, ...] in
// world-x / underground-y (scroll-invariant, like DUG keys - NOT buffer space).
// Seeded at the surface-entry point in startGame(), appended in update() once
// the drill has moved >= TRAIL_STEP from the last point, closed with the exact
// stop position in endGame(). REWIND_SCREEN walks the camera back down it.
let trail;
let rewound;                                     // did this run's end play the camera rewind? true for an underground end, false for a resurface win (already at the surface) or a resize that abandoned it - END_SCREEN only draws the drill sprite when false
let rewindI;                                     // index of the trail POINT the rewind camera is currently leaving, counting down to 0 (the surface)
let rewindT;                                     // 0..1 progress from point rewindI toward point rewindI-1
let rewindSpeed;                                 // px/sec the rewind camera travels along the polyline (derived from total path length / REWIND_DURATION, clamped)
let rewindSkip;                                   // a fresh press during the rewind sets this - updateRewind() then fast-forwards straight to the surface
let rewindArmed;                                  // gate for rewindSkip: only true once all input has been released since the rewind began, so a key held over from gameplay doesn't skip the cutscene the player never saw
let rewindFillI;                                  // trail POINT index the rainbow fill has reached, chasing rewindI down toward 0 (surface) - each segment it passes is stamped into FILLED / DUST_MASK once (see updateRewind's fill loop)

let speak;

// RENDER VARIABLES

// viewport's top-left in BUFFER space (both axes). followCamera() aims to
// keep the hero centred; when the camera drifts past a buffer edge scrollMap()
// pages that axis and re-seats cameraX/cameraY near the middle again. Fractional
// (blit/clearBuffer/renderDust all Math.floor it).
let cameraX = 0;
let cameraY = 0;
// the camera carries its own velocity (px/sec, BUFFER space) - it's a spring,
// not a lerp (see below). scrollMap() leaves these untouched: paging shifts
// cameraX and its target by the same delta, so the spring state is invariant.
let cameraVX = 0;
let cameraVY = 0;
// cameraFocus is a LAGGED copy of the hero's velocity vector (px/sec), eased
// toward the live value over CAMERA_LOOKAHEAD_LAG. The look-ahead target is
// built from this, not the instantaneous velocity - see the block below.
let cameraFocusX = 0;
let cameraFocusY = 0;
// position-locking + spring-smoothing + lagged-velocity look-ahead (the
// article's "projected focus"; see DESIGN.md camera tracking). The camera is a
// damped spring chasing  hero_centre + CAMERA_LOOKAHEAD * cameraFocus  where
// cameraFocus lags the hero's true velocity.
//
//   CAMERA_STIFFNESS  natural frequency omega (rad/s). A spring chasing a
//                     target moving at constant speed v trails it by exactly
//                     2*zeta*v/omega.
//   CAMERA_DAMPING    zeta. <1 underdamped (overshoots centre on the reel-in =
//                     a snap, not a glide), 1 = critical, >1 sluggish.
//   CAMERA_LOOKAHEAD  seconds. Leads the target by focus_speed*LOOKAHEAD px.
//                     At LOOKAHEAD = 2*zeta/omega, and once cameraFocus has
//                     caught up to the true velocity, this exactly cancels the
//                     spring trail => the cruising hero sits DEAD CENTRE at any
//                     steady speed.
//   CAMERA_LOOKAHEAD_LAG  seconds. How slowly cameraFocus tracks the real
//                     velocity - and therefore how hard a *sudden* velocity
//                     change throws the hero off centre. On a dense-patch boost
//                     the real speed jumps but cameraFocus hasn't caught up, so
//                     the look-ahead term is too short to cancel the (now
//                     larger) spring trail and the hero swings forward toward
//                     the ring; as cameraFocus catches up over ~LAG the centre
//                     lock restores and the spring reels the hero back. Bigger
//                     boost => bigger velocity jump => bigger throw. A hard
//                     turn works the same way: cameraFocus keeps pointing the
//                     OLD heading for ~LAG, so the target leads off the old way
//                     and the camera hangs behind the turn (#4). This is the
//                     ONLY knob for transient throw size; it doesn't touch the
//                     centre lock or the reel-in speed. Raise for more drama.
//
// Targets (all playtest bait): cruising hero dead centre; a full boost
// (momentum jumps toward MOMENTUM.overMax 800) throws it ~to the ring forward
// along heading; reel-in settles < 0.5s (~4/(zeta*omega) + LAG). Worst-case
// throw + turn transient must stay inside CAMERA_WIDTH/2 (~178px on the
// narrowest phone) or the hero clips the camera slice into unpainted buffer -
// stiffen omega or shorten LAG if it does, don't grow the ring.
// updateRewind() reuses the spring WITHOUT look-ahead (a trail point has no
// velocity); the bare spring's inertia is what skips the loopy-loops and
// catches the camera on the next straight - #5, the same as the turn overshoot
// with a different target.
const CAMERA_DEADZONE = 100;      // debug ring radius only - visual gauge for a full-boost throw; no effect on the sim. 100 not 112 to keep some horizontal terrain visible ahead on a narrow portrait screen
const CAMERA_STIFFNESS = 15;      // omega, rad/s
const CAMERA_DAMPING = 1.0;       // zeta. >=1 => reel-in is an ease-in/ease-out S-curve (accelerates from rest, gentle arrival, no overshoot); <1 snappier + overshoots
const CAMERA_LOOKAHEAD = 0.133;   // seconds; == 2*zeta/omega so steady-speed lag is ~0 - move in lockstep with zeta
const CAMERA_LOOKAHEAD_LAG = 0.22; // seconds; transient throw size AND how long the hero hangs thrown-out before the reel-in - raise for more drama
// draw the CAMERA_DEADZONE ring + a screen-centre crosshair over GAME/REWIND so
// the hero's (and the rewind cursor's) drift off centre is visible while tuning
// the constants above. Off by default; flip on to re-tune. (TODO.md: the draw
// block in render() + this flag get deleted only if we're over budget at
// submission.)
const DEBUG_CAMERA = false;
// screen pixels per world pixel - the ONE knob for how big everything (dust
// cells, HUD font, hero) renders. blit() stretches the viewport onto the
// canvas by exactly this factor on every device, so a dust cell is always
// CELL_SIZE*RENDER_SCALE screen px and never shrinks on a small display.
// The cost: the viewport then spans innerW/RENDER_SCALE worth of *world* px,
// so a phone genuinely sees fewer world px than a desktop - the map is
// unbounded both ways so nothing is walled off, you just see less of it at
// once. Larger value = chunkier sprites, less world on screen.
//   COUPLED WITH HUD_SCALE: the widest HUD string must fit in CAMERA_WIDTH.
//   Current worst cases: "well dug!" at HUD_SCALE+1 (9 chars, ~320 world px
//   centred), "press any key" / "score: 99999" at HUD_SCALE (13 chars,
//   ~356 centred). At RENDER_SCALE 1 a ~393px phone gives ~392 world px -
//   little margin. Raising RENDER_SCALE shrinks CAMERA_WIDTH, so bump it only
//   together with a matching drop in HUD_SCALE, checked on the narrowest
//   target. (The old "tapped out!" headline at 11 chars/HUD_SCALE+1 was the
//   binding constraint; "well drilled!" at 13 would have overflowed it.)
const RENDER_SCALE = 1;
const VIEW_MIN = 256;                   // clamp floor for either viewport axis - only guards absurdly small windows; a clamped axis means letterbox (see resizeViewport), so keep it below every real device
const VIEW_MAX = 2048;                  // clamp ceiling on either viewport axis: the 2x scroll buffer is then 4096, the safe canvas-dimension cap (iOS Safari). 4K-and-up displays pillarbox/letterbox the excess.
// camera/viewport size in world px. BOTH axes are derived from the live window
// size in resizeViewport() (= innerW/H / RENDER_SCALE, clamped) and every
// offscreen buffer is reallocated to 2x this each way (scroll lookahead).
let CAMERA_WIDTH = 1280;                // real values set by resizeViewport() before the first paint
let CAMERA_HEIGHT = 960;
const SURFACE_Y = 360;                  // world y of ground level - a FIXED sky band, deliberately not CAMERA_HEIGHT/2: extra vertical space all goes underground, and hero.y/depth/mapOffset stay valid across a live rotate because this constant never moves
const SKY_COLOR = '#9fd8ff';
const TUNNEL_COLOR = '#000';            // dug-out cell below the surface line
// underground-y (SURFACE_Y-relative, see paintRow) that MAP buffer row 0
// currently represents; scrollMap() advances this as the buffer gets paged
let mapOffset = 0;
// world-x that MAP buffer column 0 currently represents - the X-axis twin of
// mapOffset (world-x = bufferX + mapOffsetX). scrollMap() advances it on a
// horizontal page. Kept CELL_SIZE-aligned (scroll deltas and the reanchor
// delta are both snapped) so DUG keys line up. The map has no left/right
// bound - this just tracks where the finite buffer window currently sits.
let mapOffsetX = 0;
// cells dug out so far, keyed by 'worldX_undergroundY' (both CELL_SIZE-aligned;
// worldX can be negative once the drill roams left of its start).
// Set persists across scrolling so backtracking through a dug shaft doesn't
// regenerate solid material - see dig()/paintRow().
const DUG = new Set();
// subset of DUG keys the end-of-run rainbow has flooded back into: the camera
// rewind marks each dug cell it passes (updateRewind -> fillDust), and
// paintCell stamps DUST_MASK for a dug cell IFF it's in here - so the fill
// survives paging and the renderMap() that jumpCameraTo() fires on the
// REWIND -> END_SCREEN handoff. Cleared per run in startGame().
const FILLED = new Set();
// DUG key for the cell holding a world-x / underground-y point (Math.floor, not
// | 0 - the two diverge for negative world-x, see CLAUDE.md). dig() takes
// already-aligned coords so it builds its key directly instead.
const cellKey = (wx, wy) => Math.floor(wx / CELL_SIZE) * CELL_SIZE + '_' + Math.floor(wy / CELL_SIZE) * CELL_SIZE;

hero = {
  x: CAMERA_WIDTH - HERO_W / 2,         // buffer centre (buffer is 2x CAMERA_WIDTH); reanchorBuffer() re-seats it on the first resize
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
tunnel = 0;
dust = 0;
dustPop = -1;
particles = [];
trail = [hero.x + hero.w / 2 + mapOffsetX, hero.y + hero.h / 2 - SURFACE_Y + mapOffset];

const CTX = c.getContext('2d');         // visible canvas
const BUFFER = c.cloneNode();           // backbuffer
const BUFFER_CTX = BUFFER.getContext('2d');
BUFFER.width = 2 * CAMERA_WIDTH;        // 2x viewport each way: a scroll-lookahead margin the camera pages through (scrollMap). resizeViewport() re-applies both.
BUFFER.height = 2 * CAMERA_HEIGHT;
const MAP = c.cloneNode();              // static elements of the map/world cached once
const MAP_CTX = MAP.getContext('2d');
MAP.width = 2 * CAMERA_WIDTH;           // map buffer size, same as backbuffer
MAP.height = 2 * CAMERA_HEIGHT;
// dust-cell shapes only (opaque white on transparent), paged in lockstep
// with MAP by scrollMap(). Colour is applied per-frame in renderDust() by
// masking a drifting rainbow through these shapes - baking it into MAP
// wouldn't work, MAP freezes each row's colours as the buffer pages.
const DUST_MASK = c.cloneNode();
const DUST_MASK_CTX = DUST_MASK.getContext('2d');
DUST_MASK.width = 2 * CAMERA_WIDTH;
DUST_MASK.height = 2 * CAMERA_HEIGHT;
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
let DUST_PATTERN = DUST_LAYER_CTX.createPattern(DUST_GRADIENT, 'repeat');  // re-created in resizeViewport() after DUST_LAYER is resized

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
const PX_PER_M = 32;                                  // display-only: game logic is all px, the HUD converts to metres (tunnel length) and m/s (speed)
const SCORE_PER_DUST = 10;                            // points per dust cell (see endGame(): score = SCORE_PER_DUST*dust + SCORE_PER_M*metres carved - both terms reward independently)
const SCORE_PER_M = 2;                                // points per metre of virgin shaft carved
const TRAIL_STEP = 4 * CELL_SIZE;                     // min drill travel between recorded breadcrumbs (see `trail`) - coarse is fine, the rewind camera lerps between points at speed
const REWIND_DURATION = 1.1;                          // seconds the end-of-run camera rewind aims to take, whatever the path length (speed is derived, then clamped)
// END_SCREEN rainbow: a full semicircle with its left foot on the tunnel
// mouth (ingress point, or the egress point on a resurface), drawn as RAINBOW_BANDS
// concentric strokes (DUST_PALETTE, red outermost). It draws itself in from
// the left foot over the apex to the right foot (ease-out). Foot base
// (band-stack thickness) and radius both scale with `dust` collected - dust
// is the whole point, so a run that carved a long shaft but bagged no dust
// still sprouts only a stub; shaft length feeds the score, not the rainbow.
// The dust -> size curve SATURATES (k = dust / (dust + RAINBOW_DUST_HALF)):
// more dust is always a bigger rainbow, no hard cap where every real run
// pins to max, but with diminishing returns so a monster haul stays on-scale.
// A big haul overflows the sky and clips, which is fine (see DESIGN.md).
const RAINBOW_GROW = 1.4;                             // seconds for the arc to sweep the full 180 (left foot -> right foot)
const RAINBOW_BANDS = DUST_PALETTE.length;
const RAINBOW_DUST_HALF = 400;                        // dust at which the rainbow is half its max size; k = dust/(dust+this) (playtest knob - tune against the END screen's dust: line)
const RAINBOW_R_MIN = 140, RAINBOW_R_MAX = 2000;     // outer radius at 0 dust / k->1 - kept well above FOOT_MAX so the inner radius (R - foot) stays positive; a big one clips off the top of the sky
const RAINBOW_FOOT_MIN = 70, RAINBOW_FOOT_MAX = 640; // band-stack thickness at 0 dust / k->1 - MIN keeps the thinnest band (foot/7) legible (~10px); MAX lets a big haul bury the screen
const HUD_SCALE = 3;                                  // bitmap-font magnification for the in-game HUD lines
const HUD_LINE = HUD_SCALE * CHARSET_SIZE + 4;        // px between stacked HUD lines
const HUD_X = CHARSET_SIZE;                           // left-aligned HUD origin (labels stay put as values gain/lose digits)
const HUD_ADVANCE = HUD_SCALE * (CHARSET_SIZE + 1);   // px per glyph at HUD_SCALE
const DUST_COUNTER_X = HUD_X + 7 * HUD_ADVANCE;       // where the 'dust:  ' value starts (also the particles' flight target)
const DUST_COUNTER_Y = CHARSET_SIZE + 2 * HUD_LINE;   // 3rd HUD line (speed, shaft, dust)
const DUST_POP_DURATION = 0.18;                       // seconds: the counter value swells to 2x and back on each tally
const SPEED_VALUE_X = HUD_X + 7 * HUD_ADVANCE;        // where the 'speed: ' value starts, split off its label so only the number swells in the overtorque pop
const SPEED_VALUE_Y = CHARSET_SIZE;                   // 1st HUD line

let TEXT = initTextBuffer(c, CAMERA_WIDTH, CAMERA_HEIGHT);  // text buffer; re-allocated in resizeViewport() on rotate/resize


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
  mapOffset = mapOffsetX = 0;
  DUG.clear();
  FILLED.clear();
  hero = {
    x: CAMERA_WIDTH - HERO_W / 2,    // buffer centre (buffer is 2x CAMERA_WIDTH)
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
  tunnel = 0;
  dust = 0;
  dustPop = -1;
  particles = [];
  trail = [hero.x + hero.w / 2 + mapOffsetX, hero.y + hero.h / 2 - SURFACE_Y + mapOffset];
  followCamera();                   // seat the viewport on the freshly-centred hero
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
      let dx = 0, dy = 0;
      if (isPointerDown()) {
        [dx, dy] = pointerDirection();
      } else {
        // e.code is physical: AZERTY's ZQSD sits on physical KeyW/KeyQ/KeyS/
        // KeyD, so KeyW/KeyS already serve both layouts; only left needs KeyQ.
        dx = (isKeyDown('ArrowRight', 'KeyD') ? 1 : 0)
           - (isKeyDown('ArrowLeft', 'KeyA', 'KeyQ') ? 1 : 0);
        dy = (isKeyDown('ArrowDown', 'KeyS') ? 1 : 0)
           - (isKeyDown('ArrowUp', 'KeyW') ? 1 : 0);
      }
      // normalise so the forced surface dive below mixes with input at a sane
      // ratio (a long pointer drag would otherwise swamp the injected term);
      // the turn maths only cares about direction, so this is a no-op for the
      // ordinary case.
      const len = Math.hypot(dx, dy);
      if (len) { dx /= len; dy /= len; }

      // the surface is a soft ceiling (the only edge the world still has - it's
      // unbounded left/right/down): while the resurface win isn't armed yet
      // (heroWentDeep), a breach clearing it by more than a drill height forces
      // a full dive on the y input - eased through TURN_SPEED like a real
      // press, so the drill arcs back under instead of sailing off into the
      // drag-free sky. Once heroWentDeep, moveHero's depth<=0 win fires before
      // this and the breach is a clean surfacing. dx is left alone so the arc
      // can still be steered sideways.
      const breach = SURFACE_Y - mapOffset - hero.y - hero.h;   // >0 when the whole drill is above the surface line
      if (!heroWentDeep && breach > hero.h) dy = 1;

      let target;
      if (dx || dy) target = Math.atan2(dy, dx);
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
    case REWIND_SCREEN:
      // a FRESH press fast-forwards the rewind - updateRewind() (runs right
      // after this) then jumps to the surface and hands to END_SCREEN the same
      // frame. "Fresh" = input released at least once since the rewind began,
      // so an arrow key held over from nervous drilling doesn't skip a
      // cutscene the player never saw; releasing it costs nothing. (END_SCREEN
      // then also waits for release before arming its retry.)
      if (!anyKeyDown() && !isPointerDown()) rewindArmed = true;
      if (rewindArmed && (anyKeyDown() || isPointerDown())) rewindSkip = true;
      // keep the "leftover keys" snapshot current: whatever is held on the last
      // rewind frame (including the key that skipped it) is what END_SCREEN must
      // treat as held-over rather than a restart press.
      endHeld = whichKeyDown();
      break;
    case END_SCREEN:
      if (isKeyUp('KeyT')) {
        // TODO can I share an image of the game?
        share({
          title: document.title,
          text: 'Check this game template made by @herebefrogs',
          url: 'https://bit.ly/gmjblp'
        });
      }
      // a steering key still down when the run ended (or one held to skip the
      // rewind) must not restart instantly - but it also mustn't lock the retry
      // out. Two ways to restart: release everything then press anything
      // (endReady), OR press a key that wasn't already held when END_SCREEN
      // began (not in endHeld - a genuinely fresh press). (temporary: straight
      // back into a new run, no title screen.)
      if (!anyKeyDown() && !isPointerDown()) endReady = true;
      const freshPress = whichKeyDown().some(k => !endHeld.includes(k));
      if ((endReady || freshPress) && (anyKeyDown() || isPointerUp())) startGame();
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
      followCamera(true);
      recordTrail();
    }
  }
  if (screen === REWIND_SCREEN) updateRewind();
  // grow the end-of-run rainbow once the score screen is actually up (covers
  // all three ways in: resurface, rewind finishing, resize abandoning a rewind)
  if (screen === END_SCREEN) rainbowT += elapsedTime;
  // outside the screen guards: particles in flight when the run ends still
  // finish flying through the rewind and onto END_SCREEN instead of freezing.
  updateParticles();
};

// the drill head (hero centre) in world-x / underground-y - the scroll-invariant
// space DUG keys, the terrain samplers and the trail polyline all live in.
function drillWorld() {
  return [hero.x + hero.w / 2 + mapOffsetX, hero.y + hero.h / 2 - SURFACE_Y + mapOffset];
}

// append the drill head to `trail` once it has moved a full TRAIL_STEP from the
// last breadcrumb - a coarse polyline of the path for the end-of-run rewind.
function recordTrail() {
  const [wx, wy] = drillWorld();
  const n = trail.length;
  if (Math.hypot(wx - trail[n - 2], wy - trail[n - 1]) >= TRAIL_STEP) trail.push(wx, wy);
}

// the drill's leading edge in world-x / underground-y: one drill-radius + one
// cell ahead of centre along the heading. Sampled (rather than the centre,
// whose cell is dug most frames and would read "tunnel" while cutting virgin
// ground) by currentDrag() and by moveHero()'s tunnel-length accumulator.
function drillEdge() {
  const r = hero.w / 2;
  return [
    hero.x + hero.w / 2 + Math.cos(hero.angle) * (r + CELL_SIZE) + mapOffsetX,
    hero.y + hero.h / 2 + Math.sin(hero.angle) * (r + CELL_SIZE) - SURFACE_Y + mapOffset,
  ];
}

// deceleration (px/sec^2) the drill currently suffers. Mirrors paintRow()'s
// lookup order - sky, then already-dug tunnel, then virgin material - so
// backtracking up your own shaft is cheap but drilling fresh clay is punishing.
function currentDrag() {
  const [ex, ey] = drillEdge();
  if (ey < 0) return MOMENTUM.airDrag;
  return MOMENTUM.entropy + (DUG.has(cellKey(ex, ey)) ? MOMENTUM.tunnelDrag : MATERIAL_DRAG[sampleMaterial(ex, ey)]);
}

function moveHero() {
  // forward thrust along hero.angle at a speed that is finite, decaying
  // momentum - no throttle, steering only (see processInputs). Drag comes
  // from whatever the drill's leading edge is cutting through.
  hero.momentum = Math.max(0, hero.momentum - currentDrag() * elapsedTime);
  // overspeed bleed: a dense patch can boost momentum past `max` (up to
  // `overMax`) so the kick lands even at top speed; the excess then decays
  // exponentially back to `max` on top of the drag above - proportional to
  // the overshoot, so it's quick at first then eases in. Keeps the boost a
  // transient surge, not a permanent higher cap (see MOMENTUM.overBleed).
  if (hero.momentum > MOMENTUM.max) {
    hero.momentum = MOMENTUM.max + (hero.momentum - MOMENTUM.max) * Math.exp(-MOMENTUM.overBleed * elapsedTime);
  }
  hero.velX = Math.cos(hero.angle);
  hero.velY = Math.sin(hero.angle);
  // velX/velY is a unit vector, so the step length is exactly momentum*dt
  const moved = hero.momentum * elapsedTime;
  hero.x += hero.velX * moved;
  hero.y += hero.velY * moved;
  // no horizontal clamp - the map is unbounded left/right; followCamera()
  // pages the buffer under the drill wherever it roams.
  depth = Math.max(0, Math.round(hero.y + hero.h - SURFACE_Y + mapOffset));
  // tunnel length: count the step only while the leading edge is cutting undug
  // ground. Re-running an old shaft is drag-cheap and mustn't pad the score;
  // stays a plain float, only the HUD rounds. (Slight under-count on the frame
  // you first enter a fresh cell then dig it - negligible over a run.)
  const [ex, ey] = drillEdge();
  if (ey >= 0 && !DUG.has(cellKey(ex, ey))) tunnel += moved;

  if (depth >= MOMENTUM.winMinDepth) heroWentDeep = true;
  // win: back at the surface with momentum still to spare, after a real dive.
  if (heroWentDeep && depth <= 0 && hero.momentum > 0) return endGame(true);
  // lose: momentum ran out while still underground ("bingo fuel").
  if (hero.momentum <= 0) return endGame(false);
}

function endGame(resurfaced) {
  // the run can end (surfacing or bingo fuel) while particles are still
  // mid-flight; tally their dust immediately instead of leaving the score
  // dependent on how much of that cosmetic animation had time to finish.
  // They're left in `particles` (marked counted) so they still finish
  // flying visually on END_SCREEN.
  for (const p of particles) if (!p.counted) { dust++; p.counted = true; }
  // score: both terms reward independently (see SCORE_PER_DUST). Computed here,
  // after the early tally, so it doesn't depend on how many particles had
  // landed. tunnel is px; the metre count is the second term.
  score = SCORE_PER_DUST * dust + SCORE_PER_M * Math.round(tunnel / PX_PER_M);
  outcome = resurfaced;
  endReady = false;
  endHeld = whichKeyDown();   // steering keys still down at the stall/resurface - refreshed through the rewind (see processInputs), so END_SCREEN knows what's "leftover" vs a fresh restart press

  // END_SCREEN rainbow: foot at the tunnel mouth on a stall-out (the point
  // updateRewind() hard-cuts the camera back to), or at the egress point on a
  // resurface. Grow timer (rainbowT) is advanced per-frame in update() from
  // the moment END_SCREEN is actually reached, so the rewind's ~1.1s doesn't
  // eat the animation.
  rainbowX = resurfaced ? drillWorld()[0] : trail[0];
  rainbowT = 0;

  // close the trail at the exact stop position. The rewind camera walks this
  // polyline from the last point back to trail[0] (surface).
  trail.push(...drillWorld());
  // a resurface win already ends at the surface, camera and all - no rewind,
  // the rainbow sprouts at the egress point. Every other end is underground:
  // rewind the camera up the tunnel back to the surface (that walk-back is
  // what shows off the dig, and later the rainbow beamed up it). Speed is
  // derived from the true path length (loops and all), so it takes
  // ~REWIND_DURATION whatever route it drilled.
  rewound = !resurfaced;
  if (rewound) {
    let pathLen = 0;
    for (let i = 2; i < trail.length; i += 2) {
      pathLen += Math.hypot(trail[i] - trail[i - 2], trail[i + 1] - trail[i - 1]);
    }
    rewindI = trail.length / 2 - 1;
    rewindFillI = rewindI;   // rainbow fill starts at the deep end, drains up behind the camera
    rewindT = 0;
    rewindSkip = false;
    rewindArmed = false;
    // aim for REWIND_DURATION, but never crawl, and never jump more than a
    // half-buffer per frame (30fps worst case) or scrollMap's self-blit maths
    // would run past the buffer edge.
    rewindSpeed = clamp(pathLen / REWIND_DURATION, 600, CAMERA_WIDTH * 8);
    screen = REWIND_SCREEN;
  } else {
    screen = END_SCREEN;
  }
}

// stamps a fixed-radius circle around the hero's center every frame (per
// DESIGN.md: fixed-width tunnel, not variable). An axis-aligned box would've
// carved a fatter tunnel on diagonals than straight down/up.
function digShaft() {
  const [cx, cy] = drillWorld();                            // world-x, underground-y
  const r = hero.w / 2;
  for (let x = Math.floor((cx - r) / CELL_SIZE) * CELL_SIZE; x < cx + r; x += CELL_SIZE) {
    for (let y = Math.max(0, Math.floor((cy - r) / CELL_SIZE) * CELL_SIZE); y < cy + r; y += CELL_SIZE) {
      if (Math.hypot(x + CELL_SIZE / 2 - cx, y + CELL_SIZE / 2 - cy) <= r) dig(x, y);
    }
  }
}

// mark one CELL_SIZE cell as dug (worldX, undergroundY both CELL_SIZE-aligned,
// worldX may be negative) and punch the hole into the MAP buffer right away -
// converting to buffer coords (- mapOffsetX / + SURFACE_Y - mapOffset) for the
// draw. paintRow()/paintCol() also consult DUG so a previously dug cell stays
// dug after scrolling away and back.
function dig(worldX, undergroundY) {
  const key = worldX + '_' + undergroundY;
  if (!DUG.has(key)) {
    DUG.add(key);
    const bx = worldX - mapOffsetX, by = undergroundY + SURFACE_Y - mapOffset;
    MAP_CTX.fillStyle = TUNNEL_COLOR;
    MAP_CTX.fillRect(bx, by, CELL_SIZE, CELL_SIZE);
    // stop this cell shimmering now it's collected; paintRow()'s !dug check
    // keeps it clear when the row pages away and back
    DUST_MASK_CTX.clearRect(bx, by, CELL_SIZE, CELL_SIZE);
    // collection = DUG ∩ sampleDust, so a cell counts the first (only) time
    // it's dug. +1 per cell regardless of category - "dense yields more" is
    // already delivered by dense patches being solid vs sparse's ~25% mask.
    // Dense cells also top momentum back up (per-cell; digShaft clears a few
    // at once, so patch entry gives a jolt). The +1 itself isn't tallied
    // here - spawnDustParticle()'s particle carries it until it lands (or
    // the run ends, see endGame()).
    const d = sampleDust(worldX, undergroundY);
    if (d !== DUST_NONE) {
      spawnDustParticle(worldX, undergroundY);
      if (d === DUST_DENSE) hero.momentum = Math.min(MOMENTUM.overMax, hero.momentum + MOMENTUM.denseBoost);
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
// ("takeoff") at the cell's centre in BUFFER space (worldX -> bufferX via
// - mapOffsetX, same as dig()).
function spawnDustParticle(worldX, undergroundY) {
  const cx = worldX - mapOffsetX + CELL_SIZE / 2;
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
    color: dustColorAt(worldX, undergroundY),
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
      if (!p.counted) { dust++; dustPop = gameTime; }
      particles.splice(i, 1);
    }
  }
}

// move the camera toward a point in BUFFER space. smooth=true advances the
// damped spring (cameraVX/VY) one frame toward it; smooth omitted/false is a
// hard cut (snap + kill the spring velocity), which is what the
// seat/reanchor/skip callers want. Once the camera lands past a buffer edge,
// page THAT axis (shift the buffer content, patch the newly exposed strip) so
// it re-seats near the buffer's middle - the delta is computed to land it AT
// the middle, so this stays correct for an arbitrary jump, not just a
// one-frame drift. The map itself has no bounds; this only moves the finite
// buffer window around.
function centerCameraOn(bx, by, smooth) {
  const tx = bx - CAMERA_WIDTH / 2, ty = by - CAMERA_HEIGHT / 2;
  if (smooth) {
    // damped-spring step, fixed-substepped so it's stable and frame-rate
    // independent (omega*h stays small whatever the real frame took). elapsed
    // is capped like everywhere else; a slow frame just under-advances one tick.
    const k = CAMERA_STIFFNESS, z = CAMERA_DAMPING;
    for (let rem = Math.min(elapsedTime, 0.1); rem > 0; rem -= 1 / 120) {
      const h = Math.min(1 / 120, rem);
      cameraVX += (k * k * (tx - cameraX) - 2 * z * k * cameraVX) * h;
      cameraVY += (k * k * (ty - cameraY) - 2 * z * k * cameraVY) * h;
      cameraX += cameraVX * h;
      cameraY += cameraVY * h;
    }
  } else {
    cameraX = tx; cameraY = ty; cameraVX = cameraVY = 0;
  }
  if (cameraX < 0 || cameraX > MAP.width - CAMERA_WIDTH) {
    const margin = (MAP.width - CAMERA_WIDTH) / 2;
    scrollMap(Math.round((cameraX - margin) / CELL_SIZE) * CELL_SIZE, 0);
  }
  if (cameraY < 0 || cameraY > MAP.height - CAMERA_HEIGHT) {
    const margin = (MAP.height - CAMERA_HEIGHT) / 2;
    scrollMap(0, Math.round((cameraY - margin) / CELL_SIZE) * CELL_SIZE);
  }
}

// kept as its own step, decoupled from moveHero(): the camera reads hero.x/y
// but never feeds back into hero's own position. smooth=true (the gameplay
// call) eases cameraFocus toward the live hero velocity and springs toward a
// target that leads the hero by CAMERA_LOOKAHEAD * cameraFocus - a lagged
// velocity, so a sudden speed/heading change throws the hero off centre before
// the lock restores (see the CAMERA_* block). The seat/reanchor calls pass
// nothing: hard lock, and cameraFocus is snapped to the current velocity so
// the new game / post-resize frame starts centred, no launch lurch.
function followCamera(smooth) {
  const vx = hero.momentum * hero.velX, vy = hero.momentum * hero.velY;
  if (smooth) {
    const a = 1 - Math.exp(-elapsedTime / CAMERA_LOOKAHEAD_LAG);
    cameraFocusX = lerp(cameraFocusX, vx, a);
    cameraFocusY = lerp(cameraFocusY, vy, a);
  } else {
    cameraFocusX = vx; cameraFocusY = vy;
  }
  centerCameraOn(hero.x + hero.w / 2 + cameraFocusX * CAMERA_LOOKAHEAD,
                 hero.y + hero.h / 2 + cameraFocusY * CAMERA_LOOKAHEAD, smooth);
}

// hard-cut the camera onto a world-x / underground-y point, however far. Folds
// the whole delta into mapOffset/mapOffsetX and full-repaints - the same
// bookkeeping as reanchorBuffer(), just aimed at an arbitrary point instead of
// the hero - so it survives a jump bigger than scrollMap()'s self-blit could
// page (the rewind skip, landing on the surface from deep underground).
function jumpCameraTo(wx, uy) {
  const dx = Math.round((wx - mapOffsetX - MAP.width  / 2) / CELL_SIZE) * CELL_SIZE;
  const dy = Math.round((uy + SURFACE_Y - mapOffset - MAP.height / 2) / CELL_SIZE) * CELL_SIZE;
  hero.x -= dx; mapOffsetX += dx;
  hero.y -= dy; mapOffset  += dy;
  for (const p of particles) if (p.stage === 0) { p.x -= dx; p.y -= dy; }
  cameraX = wx - mapOffsetX - CAMERA_WIDTH / 2;
  cameraY = uy + SURFACE_Y - mapOffset - CAMERA_HEIGHT / 2;
  cameraVX = cameraVY = 0;   // hard cut - kill any spring velocity so it doesn't drift off the landing point
  renderMap();
}

// REWIND_SCREEN: walk the camera back down the drilled path (`trail`, world /
// underground space) from where the drill stopped up to the surface, then hand
// over to END_SCREEN. Faithfully replays loops - seeing your own detour at
// speed is the point. gameTime keeps running so the dust rainbow stays alive.
function updateRewind() {
  // distance to travel along the polyline this frame. On skip, consume it all
  // at once. Otherwise cap the frame delta - after a long hitch / tab-away an
  // uncapped step could move the camera further than a whole buffer and
  // scrollMap()'s self-blit would read past the edge (rewindSpeed*0.1 stays
  // inside the 2x buffer given the CAMERA_WIDTH*8 clamp in endGame; the two
  // constants are load-bearing together).
  let step = rewindSkip ? Infinity : rewindSpeed * Math.min(elapsedTime, 0.1);
  // advance the (rewindI, rewindT) cursor toward trail[0] along the polyline
  while (step > 0 && rewindI > 0) {
    const ax = trail[2 * rewindI],     ay = trail[2 * rewindI + 1];
    const bx = trail[2 * rewindI - 2], by = trail[2 * rewindI - 1];
    const seg = Math.hypot(bx - ax, by - ay) || 1;
    const left = (1 - rewindT) * seg;
    if (step < left) { rewindT += step / seg; step = 0; }
    else { step -= left; rewindI--; rewindT = 0; }
  }
  // flood the rainbow up the tunnel behind the retreating camera: fill each
  // trail segment the cursor has now cleared, once. rewindFillI chases rewindI
  // down to 0 (the surface). On a skip the while loop above drops rewindI to 0
  // in this same frame, so this drains every remaining segment at once.
  while (rewindFillI > rewindI) {
    fillTrailSeg(trail[2 * rewindFillI], trail[2 * rewindFillI + 1],
                 trail[2 * rewindFillI - 2], trail[2 * rewindFillI - 1]);
    rewindFillI--;
  }
  if (rewindI === 0) {
    // cursor's at the surface, but the smoothed camera lags behind it - the
    // more the run looped, the further. On a natural finish let it ease in
    // until the tunnel mouth is within the dead zone before handing off, so
    // there's no jump cut into the score screen. On a skip, don't wait:
    // hard-cut there (the skip delta from deep underground can exceed what
    // scrollMap can page).
    const bx = trail[0] - mapOffsetX, by = trail[1] + SURFACE_Y - mapOffset;
    if (!rewindSkip &&
        Math.hypot(bx - CAMERA_WIDTH / 2 - cameraX, by - CAMERA_HEIGHT / 2 - cameraY) > CAMERA_DEADZONE) {
      centerCameraOn(bx, by, true);
      return;
    }
    // reached the surface: hard-cut there and hand off. endReady is re-cleared
    // - time passed during the rewind.
    jumpCameraTo(trail[0], trail[1]);
    endReady = false;
    screen = END_SCREEN;
    return;
  }
  const j = rewindI - 1;
  const wx = lerp(trail[2 * rewindI],     trail[2 * j],     rewindT);
  const wy = lerp(trail[2 * rewindI + 1], trail[2 * j + 1], rewindT);
  // smooth: round off the corners where the drilled path looped back on itself
  centerCameraOn(wx - mapOffsetX, wy + SURFACE_Y - mapOffset, true);
}

// walk one trail segment (world-x / underground-y endpoints) in <=CELL_SIZE
// steps, flooding the rainbow into the dug cells along it. The trail is a
// coarse subsample (TRAIL_STEP), but the drill swept a full disc between
// samples, so we re-scan that disc (fillDust) at every sub-step to catch the
// whole capsule with no gaps.
function fillTrailSeg(ax, ay, bx, by) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / CELL_SIZE));
  for (let i = 0; i <= n; i++) fillDust(lerp(ax, bx, i / n), lerp(ay, by, i / n));
}

// mark the dug cells within the drill radius of world point (wx, wy) as
// rainbow-filled - same disc scan as digShaft(), so FILLED is always a subset
// of DUG (no bleed into rock on tight turns). Adds to FILLED and stamps
// DUST_MASK now (buffer coords, as dig()); paintCell re-stamps from FILLED
// when a strip pages in or renderMap() rebuilds the mask.
function fillDust(wx, wy) {
  const r = hero.w / 2;
  DUST_MASK_CTX.fillStyle = '#fff';
  for (let x = Math.floor((wx - r) / CELL_SIZE) * CELL_SIZE; x < wx + r; x += CELL_SIZE) {
    for (let y = Math.max(0, Math.floor((wy - r) / CELL_SIZE) * CELL_SIZE); y < wy + r; y += CELL_SIZE) {
      const key = x + '_' + y;
      if (DUG.has(key) && !FILLED.has(key) && Math.hypot(x + CELL_SIZE / 2 - wx, y + CELL_SIZE / 2 - wy) <= r) {
        FILLED.add(key);
        DUST_MASK_CTX.fillRect(x - mapOffsetX, y + SURFACE_Y - mapOffset, CELL_SIZE, CELL_SIZE);
      }
    }
  }
}

// self-blit the MAP + DUST_MASK buffers by (dx, dy) px and patch only the
// newly exposed strip(s), instead of resampling every visible pixel every
// frame. Keeps hero/camera pointing at the same world spot they were before.
// followCamera() only ever passes one axis at a time, but both are handled;
// with both non-zero the exposed region is an L and its corner is repainted
// twice (a full-width row strip + a full-height col strip), harmlessly.
function scrollMap(dx, dy) {
  if (!dx && !dy) return;
  // 'copy' so the (partly transparent) dust mask overwrites itself cleanly on
  // the self-blit - source-over would leave the old dust showing through the
  // gaps. It also wipes the newly-exposed strip to transparent, which the
  // paintRow()/paintCol() calls below then restamp.
  if (dy > 0) {
    MAP_CTX.drawImage(MAP, 0, dy, MAP.width, MAP.height - dy, 0, 0, MAP.width, MAP.height - dy);
    DUST_MASK_CTX.globalCompositeOperation = 'copy';
    DUST_MASK_CTX.drawImage(DUST_MASK, 0, dy, MAP.width, MAP.height - dy, 0, 0, MAP.width, MAP.height - dy);
    DUST_MASK_CTX.globalCompositeOperation = 'source-over';
    mapOffset += dy;
    for (let y = MAP.height - dy; y < MAP.height; y += CELL_SIZE) paintRow(y);
  } else if (dy < 0) {
    MAP_CTX.drawImage(MAP, 0, 0, MAP.width, MAP.height + dy, 0, -dy, MAP.width, MAP.height + dy);
    DUST_MASK_CTX.globalCompositeOperation = 'copy';
    DUST_MASK_CTX.drawImage(DUST_MASK, 0, 0, MAP.width, MAP.height + dy, 0, -dy, MAP.width, MAP.height + dy);
    DUST_MASK_CTX.globalCompositeOperation = 'source-over';
    mapOffset += dy;
    for (let y = 0; y < -dy; y += CELL_SIZE) paintRow(y);
  }
  if (dx > 0) {
    MAP_CTX.drawImage(MAP, dx, 0, MAP.width - dx, MAP.height, 0, 0, MAP.width - dx, MAP.height);
    DUST_MASK_CTX.globalCompositeOperation = 'copy';
    DUST_MASK_CTX.drawImage(DUST_MASK, dx, 0, MAP.width - dx, MAP.height, 0, 0, MAP.width - dx, MAP.height);
    DUST_MASK_CTX.globalCompositeOperation = 'source-over';
    mapOffsetX += dx;
    for (let x = MAP.width - dx; x < MAP.width; x += CELL_SIZE) paintCol(x);
  } else if (dx < 0) {
    MAP_CTX.drawImage(MAP, 0, 0, MAP.width + dx, MAP.height, -dx, 0, MAP.width + dx, MAP.height);
    DUST_MASK_CTX.globalCompositeOperation = 'copy';
    DUST_MASK_CTX.drawImage(DUST_MASK, 0, 0, MAP.width + dx, MAP.height, -dx, 0, MAP.width + dx, MAP.height);
    DUST_MASK_CTX.globalCompositeOperation = 'source-over';
    mapOffsetX += dx;
    for (let x = 0; x < -dx; x += CELL_SIZE) paintCol(x);
  }
  hero.x -= dx;
  hero.y -= dy;
  cameraX -= dx;
  cameraY -= dy;
  // stage-0 particles are buffer-space, same as hero.x/y - keep them glued to
  // their dig position through the self-blit jump (stage-1 ones are already
  // screen-space and need no correction).
  for (const p of particles) if (p.stage === 0) { p.x -= dx; p.y -= dy; }
}

// after resizeViewport() reallocates the buffers (rotate / big window resize),
// the hero can be anywhere - or entirely off the new, differently sized buffer,
// which would feed followCamera() a scroll delta larger than the buffer and
// permanently desync mapOffset/mapOffsetX. Re-seat the hero at the buffer's
// centre and absorb the shift into mapOffset/mapOffsetX so its world position
// (hence depth) is unchanged - same bookkeeping as scrollMap(), but the target
// is picked directly so it's always in range - then repaint. Both deltas are
// CELL_SIZE-snapped so the DUG key grid still lines up (dig() floors to cells;
// an unaligned offset would orphan every already-dug cell on the next repaint).
function reanchorBuffer() {
  // a resize mid-rewind reallocates the buffers under the animation and
  // re-seats the camera on the (deep) hero - resuming from there would feed
  // updateRewind() a buffer-busting jump. Just abandon the rewind and show the
  // score over wherever the hero is.
  if (screen === REWIND_SCREEN) { screen = END_SCREEN; rewound = false; }
  const dx = Math.round((hero.x - MAP.width  / 2) / CELL_SIZE) * CELL_SIZE;
  const dy = Math.round((hero.y - MAP.height / 2) / CELL_SIZE) * CELL_SIZE;
  hero.x -= dx; mapOffsetX += dx;
  hero.y -= dy; mapOffset  += dy;
  followCamera();                     // re-seat both camera axes on the new hero position
  for (const p of particles) if (p.stage === 0) { p.x -= dx; p.y -= dy; }
  renderMap();
}

// RENDER HANDLERS

function blit() {
  // copy camera portion of the backbuffer onto visible canvas, scaling it to screen dimensions
  CTX.drawImage(
    BUFFER,
    Math.floor(cameraX), cameraY, CAMERA_WIDTH, CAMERA_HEIGHT,
    0, 0, c.width, c.height
  );
  CTX.drawImage(
    TEXT,
    0, 0, CAMERA_WIDTH, CAMERA_HEIGHT,
    0, 0, c.width, c.height
  );
};

// repaint the backbuffer from MAP, but only the camera slice - nothing ever
// reads BUFFER outside it (blit and renderDust both window to the same rect).
// The buffer is 2x the viewport each way on every device, so a full-buffer
// copy every frame would be ~4x wasted fill. +1px on each axis covers blit()
// sampling BUFFER at a fractional cameraX/cameraY; drawImage clips the source
// read at the buffer edge, so the slight overshoot at the far edges is
// harmless.
function clearBuffer() {
  const bx = Math.floor(cameraX), by = Math.floor(cameraY);
  BUFFER_CTX.drawImage(MAP, bx, by, CAMERA_WIDTH + 1, CAMERA_HEIGHT + 1, bx, by, CAMERA_WIDTH + 1, CAMERA_HEIGHT + 1);
}

function render() {
  clearTextBuffer();

  switch (screen) {
    case TITLE_SCREEN:
      clearBuffer();
      renderText('title screen', CHARSET_SIZE, CHARSET_SIZE);
      renderText(isMobile ? 'tap to start' : 'press any key', CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2, ALIGN_CENTER);
      if (konamiIndex === konamiCode.length) {
        renderText('konami mode on', CAMERA_WIDTH - CHARSET_SIZE, CHARSET_SIZE, ALIGN_RIGHT);
      }
      break;
    case GAME_SCREEN:
      clearBuffer();
      renderDust();
      renderParticles();
      BUFFER_CTX.fillStyle = '#2255ee';
      BUFFER_CTX.fillRect(hero.x, hero.y, hero.w, hero.h);
      renderText('speed:', HUD_X, SPEED_VALUE_Y, ALIGN_LEFT, HUD_SCALE);
      // value drawn separately so only the number swells (2x and back) while
      // momentum sits in the overtorque band - scale tracks how far past `max`
      // it is, so the pop rides the dense-patch boost up and its bleed down.
      {
        const str = Math.round(hero.momentum / PX_PER_M) + 'm/s';
        const s = HUD_SCALE * (1 + clamp((hero.momentum - MOMENTUM.max) / (MOMENTUM.overMax - MOMENTUM.max), 0, 1));
        const cx = SPEED_VALUE_X + (str.length * HUD_SCALE * (CHARSET_SIZE + 1) - HUD_SCALE) / 2;
        renderText(str, cx, SPEED_VALUE_Y - (s - HUD_SCALE) * CHARSET_SIZE / 2, ALIGN_CENTER, s);
      }
      renderText('shaft: ' + Math.round(tunnel / PX_PER_M) + 'm', HUD_X, CHARSET_SIZE + HUD_LINE, ALIGN_LEFT, HUD_SCALE);
      renderText('dust:', HUD_X, DUST_COUNTER_Y, ALIGN_LEFT, HUD_SCALE);
      // the value briefly swells to 2x and back on each tally (see dustPop); grow about the number's own centre so it pops in place
      {
        const str = '' + dust;
        const s = HUD_SCALE * (1 + Math.sin(clamp((gameTime - dustPop) / DUST_POP_DURATION, 0, 1) * Math.PI));
        const cx = DUST_COUNTER_X + (str.length * HUD_SCALE * (CHARSET_SIZE + 1) - HUD_SCALE) / 2;
        renderText(str, cx, DUST_COUNTER_Y - (s - HUD_SCALE) * CHARSET_SIZE / 2, ALIGN_CENTER, s);
      }
      // uncomment to debug mobile input handlers
      // renderDebugTouch();
      break;
    case REWIND_SCREEN:
      // just the world, scrolling past under the camera - no HUD, no text.
      clearBuffer();
      renderDust();
      renderParticles();
      break;
    case END_SCREEN:
      // hold the world where the rewind left it (surface + tunnel mouth), or
      // where the drill resurfaced, and overlay the score. The drill sprite is
      // drawn only when there was no rewind (resurface win, or a resize that
      // abandoned it) - it's still on screen in those cases.
      clearBuffer();
      renderRainbow();
      renderDust();
      renderParticles();
      if (!rewound) {
        BUFFER_CTX.fillStyle = '#2255ee';
        BUFFER_CTX.fillRect(hero.x, hero.y, hero.w, hero.h);
      }
      // no win/lose split (the run just ends, see endGame()) - but a run that
      // bagged no dust grew no rainbow, so nudge the player to collect next
      // time. Both headlines are <= 9 chars at HUD_SCALE+1 (the CAMERA_WIDTH
      // fit constraint, see the RENDER_SCALE comment). outcome is still
      // recorded for future share text.
      renderText(dust ? 'well dug!' : 'dry run!', CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2 - 2 * HUD_LINE, ALIGN_CENTER, HUD_SCALE + 1);
      // metric lines share a left edge (7-char label field), like the in-game
      // HUD - centre-aligning each line drifts the labels as the values change
      // width. mx roughly centres the block.
      {
        const mx = CAMERA_WIDTH / 2 - 6 * HUD_ADVANCE;
        renderText('shaft: ' + Math.round(tunnel / PX_PER_M) + 'm', mx, CAMERA_HEIGHT / 2 + HUD_LINE, ALIGN_LEFT, HUD_SCALE);
        renderText(' dust: ' + dust, mx, CAMERA_HEIGHT / 2 + 2 * HUD_LINE, ALIGN_LEFT, HUD_SCALE);
        renderText('score: ' + score, mx, CAMERA_HEIGHT / 2 + 3 * HUD_LINE, ALIGN_LEFT, HUD_SCALE);
      }
      if (endReady) renderText(isMobile ? 'tap to retry' : 'press any key', CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2 + 5 * HUD_LINE, ALIGN_CENTER, HUD_SCALE);
      // renderText(monetizationEarned(), TEXT.width - CHARSET_SIZE, TEXT.height - 2*CHARSET_SIZE, ALIGN_RIGHT);
      break;
  }

  blit();

  if (DEBUG_CAMERA && (screen === GAME_SCREEN || screen === REWIND_SCREEN)) {
    // screen space, straight on the visible canvas after the blit. CAMERA_DEADZONE
    // is world px; blit stretches CAMERA_WIDTH world px across c.width screen px.
    const s = c.width / CAMERA_WIDTH;
    const mx = c.width / 2, my = c.height / 2, r = CAMERA_DEADZONE * s;
    CTX.strokeStyle = 'rgba(255,255,255,.4)';
    CTX.lineWidth = 1;
    CTX.beginPath();
    CTX.arc(mx, my, r, 0, 2 * Math.PI);
    CTX.moveTo(mx - r - 12, my); CTX.lineTo(mx + r + 12, my);
    CTX.moveTo(mx, my - r - 12); CTX.lineTo(mx, my + r + 12);
    CTX.stroke();
  }
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
  // is offset by the camera's WORLD origin (mod tile size) so it tracks the
  // terrain, plus a steady time phase so it also drifts at a constant rate.
  // Scratch row 0 sits at world x = (cx + mapOffsetX), underground y =
  // (cy - SURFACE_Y + mapOffset); mapOffsetX/mapOffset are cell-aligned ints
  // so the mod stays exact. Phase is floored to whole px - integer offsets
  // keep the pattern pixel-aligned (smoothing is off), crisp 1px scroll steps.
  const phase = Math.floor(gameTime * DUST_SPEED);
  const tx = -((((cx + mapOffsetX) % DUST_P) + DUST_P) % DUST_P);
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

// END_SCREEN: the sprouted rainbow (see the RAINBOW_* constants). A full
// semicircle with its left foot on rainbowX, RAINBOW_BANDS concentric strokes
// (red DUST_PALETTE[0] outermost), drawn outer-to-inner so each band's inner
// edge covers the previous stroke's AA seam. Draws itself in from that left
// foot over the apex to the far foot over RAINBOW_GROW seconds (ease-out).
// Buffer space: ground line y = SURFACE_Y - mapOffset (paintCell's inverse).
function renderRainbow() {
  if (!dust) return;                                        // no dust collected -> no rainbow (see the 'dry run!' headline)
  const k = dust / (dust + RAINBOW_DUST_HALF);              // 0..1, saturating: always grows with dust, never pins to max
  const R = lerp(RAINBOW_R_MIN, RAINBOW_R_MAX, k);          // outer radius
  const footBase = lerp(RAINBOW_FOOT_MIN, RAINBOW_FOOT_MAX, k);
  const band = footBase / RAINBOW_BANDS;
  const r0 = R - footBase;                                  // inner radius
  // left foot straddles rainbowX: arc centre sits one mid-radius to its right,
  // on the ground line, so the arc climbs up-and-right from the tunnel mouth.
  const cx = rainbowX - mapOffsetX + R - footBase / 2;
  const cy = SURFACE_Y - mapOffset;
  const p = clamp(rainbowT / RAINBOW_GROW, 0, 1);
  const sweep = (1 - (1 - p) ** 2) * Math.PI;               // ease-out, left foot -> apex -> right foot
  BUFFER_CTX.lineCap = 'butt';
  for (let i = 0; i < RAINBOW_BANDS; i++) {
    BUFFER_CTX.strokeStyle = DUST_PALETTE[i];
    BUFFER_CTX.lineWidth = band + 1;                        // +1 overlap kills hairline gaps
    BUFFER_CTX.beginPath();
    BUFFER_CTX.arc(cx, cy, r0 + (RAINBOW_BANDS - 0.5 - i) * band, Math.PI, Math.PI + sweep);
    BUFFER_CTX.stroke();
  }
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

// paint one CELL_SIZE cell of the MAP buffer (+ its DUST_MASK cell) from the
// procedural terrain: (x, y) are BUFFER coords, converted to world x =
// (x + mapOffsetX) / underground y = (y - SURFACE_Y + mapOffset) for the DUG
// key and the terrain samplers. Sky above ground, dug tunnel, then virgin
// material - same lookup order as currentDrag(). The caller clears the
// DUST_MASK strip once (this only *adds* the opaque cell), since dust rides a
// transparent-backed buffer and would ghost otherwise; DENSE/SPARSE is
// irrelevant to the render (yield is carried by the fill - dense solid, sparse
// ~25% dither - colour is one shared cycling hue). DUG cells are skipped so
// they stop shimmering once collected and stay skipped when paged back in.
function paintCell(x, y) {
  const wx = x + mapOffsetX;
  const underground = y - SURFACE_Y + mapOffset;
  const key = wx + '_' + underground;
  const dug = DUG.has(key);
  MAP_CTX.fillStyle = underground < 0 ? SKY_COLOR : dug ? TUNNEL_COLOR : materialColor(sampleMaterial(wx, underground));
  MAP_CTX.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  // dust mask: virgin dust cells, OR dug cells the end-run rainbow has flooded
  // (FILLED) - both get the same drifting-rainbow colouring in renderDust().
  if (underground >= 0 && (dug ? FILLED.has(key) : sampleDust(wx, underground) !== DUST_NONE)) {
    DUST_MASK_CTX.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  }
}

// one CELL_SIZE-tall band of the buffer - the initial full paint and a
// vertical page (scrollMap dy) both build rows this way.
function paintRow(y) {
  DUST_MASK_CTX.clearRect(0, y, MAP.width, CELL_SIZE);
  DUST_MASK_CTX.fillStyle = '#fff';
  for (let x = 0; x < MAP.width; x += CELL_SIZE) paintCell(x, y);
};

// one CELL_SIZE-wide column - a horizontal page (scrollMap dx) exposes these.
function paintCol(x) {
  DUST_MASK_CTX.clearRect(x, 0, CELL_SIZE, MAP.height);
  DUST_MASK_CTX.fillStyle = '#fff';
  for (let y = 0; y < MAP.height; y += CELL_SIZE) paintCell(x, y);
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

// derive both viewport axes from the live window size at the fixed
// RENDER_SCALE (so on-screen sizes never change), clamped to [VIEW_MIN,
// VIEW_MAX] and snapped to CELL_SIZE (whole buffer rows/cols). If either
// axis moved, reallocate every offscreen buffer - MAP/BUFFER/DUST_MASK are
// 2x the viewport each way (scroll-lookahead margin the camera pages through),
// DUST_LAYER/TEXT viewport-sized - and return true so the caller repaints
// (resizing a canvas wipes its bitmap and resets its 2D context, hence the
// smoothing re-disable here). Only acts on a real change - mobile fires resize
// on every URL-bar show/hide.
function resizeViewport() {
  const w = clamp(Math.round(innerWidth  / RENDER_SCALE / CELL_SIZE) * CELL_SIZE, VIEW_MIN, VIEW_MAX);
  const h = clamp(Math.round(innerHeight / RENDER_SCALE / CELL_SIZE) * CELL_SIZE, VIEW_MIN, VIEW_MAX);
  if (w === CAMERA_WIDTH && h === CAMERA_HEIGHT) return false;
  CAMERA_WIDTH = w;
  CAMERA_HEIGHT = h;
  for (const buf of [BUFFER, MAP, DUST_MASK]) {
    buf.width = 2 * CAMERA_WIDTH;
    buf.height = 2 * CAMERA_HEIGHT;
  }
  DUST_LAYER.width = CAMERA_WIDTH;
  DUST_LAYER.height = CAMERA_HEIGHT;
  DUST_PATTERN = DUST_LAYER_CTX.createPattern(DUST_GRADIENT, 'repeat');
  TEXT = initTextBuffer(c, CAMERA_WIDTH, CAMERA_HEIGHT);
  MAP_CTX.imageSmoothingEnabled = BUFFER_CTX.imageSmoothingEnabled = DUST_MASK_CTX.imageSmoothingEnabled = DUST_LAYER_CTX.imageSmoothingEnabled = false;
  return true;
}

onresize = onrotate = function() {
  const buffersChanged = resizeViewport();

  // fit the viewport to the window at RENDER_SCALE. With no clamp active the
  // min collapses to exactly RENDER_SCALE and the canvas fills the window; a
  // clamped axis (4K+ display) pillar/letterboxes the overflow. blit()
  // repaints c every frame, so a bare c resize needs no explicit redraw.
  const scaleToFit = Math.min(innerWidth / CAMERA_WIDTH, innerHeight / CAMERA_HEIGHT);
  c.width = CAMERA_WIDTH * scaleToFit;
  c.height = CAMERA_HEIGHT * scaleToFit;
  CTX.imageSmoothingEnabled = false;   // resizing c above just reset its context

  // the offscreen buffers were wiped by the realloc - re-seat the hero in the
  // new buffer and repaint from mapOffset/mapOffsetX + DUG (onload does its own
  // initial renderMap() after this for the no-realloc case)
  if (buffersChanged) reanchorBuffer();

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

