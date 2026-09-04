import { isKeyDown, anyKeyDown, isKeyUp, whichKeyDown } from './inputs/keyboard';
import { isPointerDown, isPointerUp, pointerCanvasPosition, pointerDirection, pointerPad } from './inputs/pointer';
import { isMobile } from './mobile';
import { checkMonetization, isMonetizationEnabled } from './monetization';
import { share } from './share';
import { loadSongs, playSound, playSong, renderSong, playMusic, stopMusic, resumeAudio, suspendAudio, setVolume, MASTER_VOLUME } from './sound';
import { initSpeech } from './speech';
import SONG_GAME from './song-game';
import { save, load } from './storage';
import { ALIGN_LEFT, ALIGN_CENTER, ALIGN_RIGHT, CHARSET_SIZE, renderText, renderBubble, textWidth, initTextBuffer, clearTextBuffer } from './text';
import { clamp, getRandSeed, setRandSeed, loadImg, lerp } from './utils';
import { CELL_SIZE, CLAY, sampleMaterial, materialColor, MATERIAL_DRAG, sampleDust, DUST_NONE, DUST_DENSE, setMapSeed } from './terrain';
import TILESET from '../img/tileset.webp';



// GAMEPLAY VARIABLES

const TITLE_SCREEN = 0;
const GAME_SCREEN = 1;
const REWIND_SCREEN = 2;   // run over: camera fast-walks the drilled path back up to the surface (see updateRewind), then -> END_SCREEN
const END_SCREEN = 3;
const HIGHSCORE_SCREEN = 4;   // reached from the TITLE_SCREEN menu, returns to it - not part of the main TITLE->...->END flow
let screen = TITLE_SCREEN;

// factor by which to reduce both velX and velY when player moving diagonally
// so they don't seem to move faster than when traveling vertically or horizontally
const NORMALIZE_DIAGONAL = Math.cos(Math.PI / 4);

const HERO_W = 28;                             // collision AABB + drill radius (hero.w/2); the unicorn sprite is drawn rigidly around this, a few px of leg/horn spill is fine
const HERO_H = 28;
const UNICORN_ACCENT = '#a24bd6';             // horn + tail; everything else white
const LEG_WIGGLE = 0.35;                       // radians of leg-phase advance per world px travelled - gait speeds up with momentum (see moveHero, hero.legPhase)
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
  overMax: 800,               // hard cap on the transient overshoot a dense patch can stack up (~1.33x max) - the kick is felt even when you enter a patch already at `max`. (digShaft sweeps the drill disc along the frame's path now, so a fast step no longer risks a tunnel gap - but keep this sane.)
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
let rainbowX;                                     // world-x of the END_SCREEN single bow's foot = the ingress mouth (trail[0]), where the camera rewind lands - same for a stall and a plain resurface. On a double it's the ingress side (inner bow foot); set in endGame()
let rainbowX2;                                    // world-x of the EGRESS hole when a resurface earns the double rainbow (holes RAINBOW_DOUBLE_MIN..MAX of a viewport apart) - outer bow grows from here, inner from rainbowX, toward each other; the rewind then lands the camera on the (rainbowX+rainbowX2)/2 midpoint; undefined for the normal single arch
let rainbowT;                                     // seconds accrued on END_SCREEN, drives the rainbow's grow sweep (see RAINBOW_GROW); reset in endGame(), advanced in update()
// breadcrumb polyline of the drill's path, flat [wx0, uy0, wx1, uy1, ...] in
// world-x / underground-y (scroll-invariant, like DUG keys - NOT buffer space).
// Seeded at the surface-entry point in startGame(), appended in update() once
// the drill has moved >= TRAIL_STEP from the last point, closed with the exact
// stop position in endGame(). REWIND_SCREEN walks the camera back down it.
let trail;
let prevDrill;                                    // drill centre (world-x / underground-y) at the end of last frame's dig; digShaft carves the capsule from it to this frame's centre so the tunnel can't gap (launch, or a frame hitch)
let rewound;                                    // did this run's end play the camera rewind? true for every run end now (stall AND resurface both retrace the dig) - only a resize abandoning the rewind mid-play sets it false, and END_SCREEN draws the drill sprite in that one case
let rewindI;                                     // index of the trail POINT the rewind camera is currently leaving, counting down to 0 (the surface)
let rewindT;                                     // 0..1 progress from point rewindI toward point rewindI-1
let rewindSpeed;                                 // px/sec the rewind camera travels along the polyline (derived from total path length / REWIND_DURATION, clamped)
let rewindSkip;                                   // a fresh press during the rewind sets this - updateRewind() then fast-forwards straight to the surface
let rewindArmed;                                  // gate for rewindSkip: only true once all input has been released since the rewind began, so a key held over from gameplay doesn't skip the cutscene the player never saw
let rewindFillI;                                  // trail POINT index the rainbow fill has reached, chasing rewindI down toward 0 (surface) - each segment it passes is stamped into FILLED / DUST_MASK once (see updateRewind's fill loop)

let speak;

// Background music. One track (SONG_GAME) rendered to an AudioBuffer at load
// (renderSong blocks ~40ms/channel), playing under GAME + REWIND + END - the
// title screen is silent. musicUnlocked flips on the first input gesture
// (autoplay needs one, and TITLE's own Start press supplies it - see
// unlockMusic); until then updateMusic() is inert. musicBuffer tracks what's
// currently looping (or undefined) so a screen change only touches playback
// when it actually needs to start or stop.
let musicGame, musicBuffer;
let musicUnlocked;
let volumePct = MASTER_VOLUME * 100;             // M cycles it (processInputs), or the title menu's Music item; see cycleVolume()

function updateMusic() {
  if (!musicUnlocked) return;
  const want = screen === GAME_SCREEN || screen === REWIND_SCREEN || screen === END_SCREEN ? musicGame : undefined;
  if (want && want !== musicBuffer) {
    playMusic(want);
    musicBuffer = want;
  } else if (!want && musicBuffer) {
    stopMusic();
    musicBuffer = undefined;
  }
}

// shared by the M key (any screen) and the title menu's Music item. Steps the
// volume up by VOLUME_STEP percentage points, wrapping back to 0 once it'd
// pass VOLUME_MAX - integer percent throughout (not a 0..1 float) so repeated
// steps can't drift off their round numbers.
const VOLUME_STEP = 10;
const VOLUME_MAX = 50;
function cycleVolume() {
  volumePct = volumePct >= VOLUME_MAX ? 0 : volumePct + VOLUME_STEP;
  setVolume(volumePct / 100);
}

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
// draw the full floating-D-pad breakdown (pad ring, per-axis dead bands,
// steering spoke, raw finger dot) instead of the plain base+knob. Tuning aid.
const DEBUG_POINTER = false;
// screen pixels per world pixel - the ONE knob for how big everything (dust
// cells, HUD font, hero) renders. blit() stretches the viewport onto the
// canvas by exactly this factor on every device, so a dust cell is always
// CELL_SIZE*RENDER_SCALE screen px and never shrinks on a small display.
// The cost: the viewport then spans innerW/RENDER_SCALE worth of *world* px,
// so a phone genuinely sees fewer world px than a desktop - the map is
// unbounded both ways so nothing is walled off, you just see less of it at
// once. Larger value = chunkier sprites, less world on screen.
//   COUPLED WITH HUD_SCALE: the widest HUD string must fit in CAMERA_WIDTH.
//   Worst case is the centred END retry line "Press any key to play again" at
//   HUD_SCALE. Condensed Impact is far narrower than the old bitmap cell so
//   there's margin (a ~393px phone at RENDER_SCALE 1 sees ~392 world px), but
//   that line is close - check it on the narrowest target if it grows.
//   Raising RENDER_SCALE shrinks CAMERA_WIDTH, so bump it only together with a
//   matching drop in HUD_SCALE.
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
  legPhase: 0,                          // render-only: advanced by distance travelled in moveHero(), drives the leg wiggle
};
heroWentDeep = false;
depth = 0;
tunnel = 0;
dust = 0;
dustPop = -1;
particles = [];
trail = [hero.x + hero.w / 2 + mapOffsetX, hero.y + hero.h / 2 - SURFACE_Y + mapOffset];
prevDrill = trail.slice();              // drill centre last frame (world/underground); digShaft carves the capsule between it and now

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
// double rainbow (resurface only): earn a 2nd arch - one span with a foot in
// each surface breach + a nested reversed secondary - when the egress hole is
// between these fractions of the viewport width from the ingress hole. Below
// MIN the two feet don't read as a span; above MAX they won't both frame up
// even after the END_SCREEN camera recentres between them. Outside -> the
// normal single arch at the egress. Playtest knobs.
const RAINBOW_DOUBLE_MIN = 0.25, RAINBOW_DOUBLE_MAX = 0.85;
// how far the two bows miss the opposite hole, as a fraction of the half-span:
// the outer overshoots its far hole by this, the inner falls this short - so
// each bow stays visibly pinned to its own hole rather than both bridging.
const RAINBOW_DOUBLE_OVERSHOOT = 0.15;
let TEXT = initTextBuffer(c, CAMERA_WIDTH, CAMERA_HEIGHT);  // text buffer; re-allocated in resizeViewport() on rotate/resize

const HUD_SCALE = 3;                                  // text box-height multiplier for the in-game HUD lines
const HUD_LINE = HUD_SCALE * CHARSET_SIZE + 4;        // px between stacked HUD lines
const HUD_X = CHARSET_SIZE;                           // left-aligned HUD origin (labels stay put as values gain/lose digits)
// shared value column for the Speed and Dust lines (one label-field past HUD_X,
// widest label wins) - the value is split off its label so only the number
// swells in the pop. Also the dust particles' flight target.
const SPEED_VALUE_X = HUD_X + Math.max(textWidth('Speed: ', HUD_SCALE), textWidth('Dust: ', HUD_SCALE));
const DUST_COUNTER_X = SPEED_VALUE_X;
const DUST_COUNTER_Y = CHARSET_SIZE + 2 * HUD_LINE;   // 3rd HUD line (speed, shaft, dust)
const DUST_POP_DURATION = 0.18;                       // seconds: the counter value swells to 2x and back on each tally
const SPEED_VALUE_Y = CHARSET_SIZE;                   // 1st HUD line


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

// world-x the drill descends from. The hero always spawns buffer-centred (so
// the camera seats on it whatever the viewport size), and mapOffsetX carries
// its world position — but a bare buffer-centred spawn lands at world-x
// CAMERA_WIDTH, which moves with the window and could drop the drill into a
// rock. Instead: walk right in SPAWN_STEP jumps until the column the drill
// will cut ([x - HERO_W/2, x + HERO_W/2] over the first HERO_H*4 of descent)
// is clay-free. Deterministic — same seed, same column, whatever the window.
const SPAWN_STEP = 32;   // ~HERO_W, CELL_SIZE-aligned so mapOffsetX stays on the cell grid
function pickSpawnX() {
  for (let x = 0; x < SPAWN_STEP * 64; x += SPAWN_STEP) {
    let clear = true;
    for (let sx = x - HERO_W / 2; sx < x + HERO_W / 2; sx += CELL_SIZE)
      for (let sy = 0; sy < HERO_H * 4; sy += CELL_SIZE)
        if (sampleMaterial(sx + CELL_SIZE / 2, sy + CELL_SIZE / 2) === CLAY) clear = false;
    if (clear) return x;
  }
  return 0;   // pathological: nothing clear within 2048px, take the origin
}

// Seat the world on the clay-free spawn column: hero buffer-centred, mapOffsetX
// carrying its world-x, camera hard-locked on it. Shared by startGame() and the
// boot title backdrop (onload / a resize on TITLE) so TITLE -> GAME shows one
// continuous frame - without it the title sits on the raw 0,0 column,
// which may be rock, and the drill visibly jumps when startGame() walks clear.
function seatSpawn() {
  cameraX = cameraY = 0;
  mapOffset = 0;
  mapOffsetX = pickSpawnX() - CAMERA_WIDTH;   // buffer-centred hero (x = CAMERA_WIDTH - HERO_W/2) then sits at the clear world-x
  hero.x = CAMERA_WIDTH - HERO_W / 2;
  hero.y = SURFACE_Y - HERO_H;
  hero.velX = hero.velY = 0;
  followCamera();                             // hard lock (no smooth): snaps focus + zeroes spring velocity
}

function startGame() {
  // setRandSeed(getRandSeed());
  // if (isMonetizationEnabled()) { unlockExtraContent() }
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
    legPhase: 0,
  };
  seatSpawn();                       // mapOffsetX + camera onto the clay-free spawn column
  heroWentDeep = false;
  outcome = undefined;
  depth = 0;
  tunnel = 0;
  dust = 0;
  dustPop = -1;
  particles = [];
  trail = [hero.x + hero.w / 2 + mapOffsetX, hero.y + hero.h / 2 - SURFACE_Y + mapOffset];
  prevDrill = trail.slice();        // drill centre last frame - starts above the surface, see digShaft
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

// same conversion as pointerMapPosition but without the camera offset - the
// coordinate space TEXT/HUD elements (incl. the title menu) are drawn in.
const pointerViewportPosition = () => {
  const [x, y] = pointerCanvasPosition(c.width, c.height);
  return [x*CAMERA_WIDTH/c.width, y*CAMERA_HEIGHT/c.height];
}

// TITLE_SCREEN menu: which row is selected (Up/Down/tap move it, Enter/tap
// triggers it). Only 2 items for now - see TODO.md's options-panel item for
// what else lands here later.
let titleIndex = 0;
let titleArmed = false;   // release-then-fresh-press gate so a key/tap held over from reaching TITLE_SCREEN (e.g. backing out of HIGHSCORE_SCREEN) doesn't instantly fire the menu item under the cursor - see processInputs()
const SEED_LABEL_SCALE = 1.5;   // small corner credit line, not a menu item - see the TITLE_SCREEN render() case
function titleMenuItems() {
  return [
    { label: 'Start', action: beginTitleJump },
    // sizeLabel: a stand-in for layout math - the live label's width changes
    // as volumePct's digit count does (0% vs 10%+), which would otherwise
    // jiggle the whole centred block every step; '50%' covers the widest
    // case (VOLUME_MAX) so the reserved width never moves. Fine if the live
    // label sits a touch narrower than that - it's left-aligned, not centred.
    { label: '[M]usic: ' + volumePct + '%', sizeLabel: '[M]usic: 50%', action: cycleVolume },
    { label: 'Highscores', action: goHighscores },
    { label: 'New seed', action: rerollSeed },
  ];
}

// reroll a fresh random terrain+dust pair (no typing required - see the
// title-menu item above) and re-seat + repaint the title backdrop on it, same
// as onload's boot sequence (seatSpawn + renderMap), so the dust patches /
// resting unicorn shown always match the new terrain instead of a jarring
// jump-cut the moment GAME_SCREEN starts. getRandSeed(true) ignores the URL
// and returns 6 random base64 chars (boilerplate helper in utils.js),
// uppercased for readability (costs some of base64's variety, worth it);
// called twice for independent terrain/dust halves, off Math.random - not
// hash2D, not the (unused) utils.js prng stream, matching how the rest of the
// game's cosmetic randomness (e.g. particle jitter) already draws straight
// from Math.random.
function rerollSeed() {
  applySeed(getRandSeed(true).toUpperCase(), getRandSeed(true).toUpperCase());
  seatSpawn();
  renderMap();
}

// Row layout for both render() (draws each label) and processInputs() (hit-
// tests taps). The whole block is centred horizontally and vertically in the
// lower half of the screen, below the surface line, so the unicorn/Iris/
// speech-bubble framing above it stays clear - but labels inside it are left
// aligned (flush to one another) with the "> " selection chevron in its own
// column to the left, so a label never shifts when it becomes selected. Each
// row's tap box spans the full block width (padded well past the text) for a
// comfortable, consistent mobile tap target.
const TITLE_MENU_SCALE = 3;
const TITLE_MENU_ROW = TITLE_MENU_SCALE * CHARSET_SIZE + 16;
const TITLE_MENU_PAD = CHARSET_SIZE * 2;
function titleMenuLayout() {
  const items = titleMenuItems();
  const blockH = items.length * TITLE_MENU_ROW;
  const lowerHalfTop = CAMERA_HEIGHT / 2;
  const top = lowerHalfTop + (CAMERA_HEIGHT - lowerHalfTop - blockH) / 2;
  const chevronW = textWidth('>  ', TITLE_MENU_SCALE);   // extra trailing space: a visual gap before the label column
  const labelW = Math.max(...items.map(item => textWidth(item.sizeLabel || item.label, TITLE_MENU_SCALE)));
  const blockW = chevronW + labelW;
  const left = CAMERA_WIDTH / 2 - blockW / 2;
  return items.map((item, i) => {
    const y0 = top + i * TITLE_MENU_ROW;
    return {
      ...item,
      textY: y0 + (TITLE_MENU_ROW - TITLE_MENU_SCALE * CHARSET_SIZE) / 2,
      chevronX: left,
      labelX: left + chevronW,
      x0: left - TITLE_MENU_PAD,
      x1: left + blockW + TITLE_MENU_PAD,
      y0,
      y1: y0 + TITLE_MENU_ROW,
    };
  });
}

// Title-screen unicorn: rests offset left of hero's true buffer position
// (hero.x/y stay authoritative for the camera/terrain the whole time - see
// drawHero's offsetX/Y params - so a resize mid-hop just re-seats the real
// spawn under her and the cosmetic offset keeps ticking) until Start fires,
// then hops the offset back to 0 along a semicircle and hands off to
// startGame(). RX/RY are separate (not one shared radius) so "slightly
// offset" and "jump in the air" can be tuned independently.
const TITLE_JUMP_RX = 60;
const TITLE_JUMP_RY = 100;
const TITLE_JUMP_DURATION = 0.5;
let titleJumpT = 0;         // 0 = resting title pose, 1 = arrived at the real game-start pose
let titleJumping = false;
function beginTitleJump() { titleJumping = true; }
// advanced from update() (a per-screen animation timer, same shape as
// updateRewind()) - never from processInputs(), which only applies input.
function updateTitleJump() {
  titleJumpT = Math.min(1, titleJumpT + elapsedTime / TITLE_JUMP_DURATION);
  if (titleJumpT >= 1) { titleJumping = false; startGame(); }
}
// smoothstep, not linear - a linear theta sweeps constant angular velocity
// (fast at the apex, slow at the feet), the opposite of how a real hop reads;
// this fronts the motion at launch and settles it on landing.
const easeTitleJump = t => t * t * (3 - 2 * t);
function titleJumpPose() {
  const t = easeTitleJump(titleJumpT);
  const theta = Math.PI * (1 - t);
  return {
    x: TITLE_JUMP_RX * Math.cos(theta) - TITLE_JUMP_RX,
    y: -TITLE_JUMP_RY * Math.sin(theta),
    // 0 (facing right, standing on the surface) at rest -> PI/2 (drilling
    // pose) on landing, matching the fresh hero startGame() builds - lands
    // already pointed the way GAME_SCREEN expects, no snap on the handoff frame.
    angle: t * Math.PI / 2,
  };
}

// HIGHSCORE_SCREEN: table over the same dust/hero backdrop as TITLE_SCREEN
// (see its render() case), reached via the title menu's Highscores item.
// Doubles as a seed picker - Up/Down/Enter or a tap on a row loads that seed
// and drops back to the title menu on it (selectSeed) - Start still fires the
// jump animation from there. A tap elsewhere, or any other key, also returns
// to the title menu (on whatever seed was already active). highscoreReady is
// the same "wait for a full release before a fresh
// press counts" gate as endReady/titleArmed, needed because Enter/tap
// selecting the menu item is often still held down on the very first
// HIGHSCORE_SCREEN frame.
let highscoreReady;
let highscoreIndex = 0;
function goHighscores() { screen = HIGHSCORE_SCREEN; highscoreReady = false; highscoreIndex = 0; }

// cap the stored table so a pile of one-off seeds (esp. from "New seed")
// doesn't grow localStorage - and the screen - without bound; see endGame().
const HIGHSCORE_MAX = 10;

const HS_SCALE = 2.5;   // a touch smaller than the title menu (TITLE_MENU_SCALE) - 3 columns run too wide on mobile at that size
const HS_ROW = HS_SCALE * CHARSET_SIZE + 10;
const HS_COL_GAP = CHARSET_SIZE * 2;
const HS_HEADERS = ['Seed', 'Score', 'Date'];

// highscores are keyed by seed ("terrain-dust", see runSeed/endGame) -
// flatten to rows and rank by score, best first.
function highscoreRows() {
  const table = load('highscores') || {};
  return Object.keys(table)
    .map(seed => ({ seed, score: table[seed].score, date: table[seed].date }))
    .sort((a, b) => b.score - a.score);
}

// column widths sized off the widest cell (header included) in that column -
// same "measure before centring" approach as titleMenuLayout's labelW, so a
// short seed/score/date never leaves a ragged gap before the next column. A
// chevron gutter (same idea as titleMenuLayout's) sits left of the Seed
// column so the selected-row marker never shifts the table; each row also
// gets a titleMenuLayout-style padded tap box spanning the full table width.
function highscoreLayout() {
  const data = highscoreRows();
  const cols = [
    ['Seed', ...data.map(r => r.seed)],
    ['Score', ...data.map(r => '' + r.score)],
    ['Date', ...data.map(r => r.date)],
  ];
  const colW = cols.map(vals => Math.max(...vals.map(v => textWidth(v, HS_SCALE))));
  const chevronW = textWidth('>  ', HS_SCALE);
  const tableW = chevronW + colW[0] + colW[1] + colW[2] + HS_COL_GAP * 2;
  const left = CAMERA_WIDTH / 2 - tableW / 2;
  const colX = [left + chevronW, left + chevronW + colW[0] + HS_COL_GAP, left + chevronW + colW[0] + colW[1] + HS_COL_GAP * 2];
  const top = CAMERA_HEIGHT / 2 + HS_ROW;   // a row below the surface line, header first
  const rows = data.map((r, i) => {
    const y0 = top + (i + 1) * HS_ROW;
    return { ...r, chevronX: left, x0: left - TITLE_MENU_PAD, x1: left + tableW + TITLE_MENU_PAD, y0, y1: y0 + HS_ROW };
  });
  return { rows, colX, top };
}

// load a highscore row's seed and drop back to TITLE_SCREEN on it (not
// straight into a run - that would skip the title hop/jump animation) -
// re-seats + repaints the backdrop same as rerollSeed, so the unicorn/dust
// shown already match what Start is about to drill into.
function selectSeed(seed) {
  const [terrainStr, dustStr] = seed.split('-');
  applySeed(terrainStr, dustStr);
  seatSpawn();
  renderMap();
  screen = TITLE_SCREEN;
}

// Iris's title-screen-only speech bubble: a plain white rounded rect (comic-
// book caption style, no tail) in the sky - below the title, above the
// surface line (titleMenuLayout's lowerHalfTop) - centred in that band and
// nudged right of the screen's horizontal centre. Doesn't have to line up
// exactly with the unicorn/Iris art that lands later.
const BUBBLE_SCALE = 2;
const BUBBLE_LINE = BUBBLE_SCALE * CHARSET_SIZE + 6;
const BUBBLE_PAD = 14;
const BUBBLE_RADIUS = 12;
const BUBBLE_MARGIN = 10;    // never let the box itself touch the screen edge, any viewport width
// last line spells out the controls - always shown, mobile/desktop text differs.
const BUBBLE_LINES = [
  'I have a message to deliver.',
  'Collect dust to grow a',
  'rainbow bridge.',
  '',
  isMobile ? 'Swipe to move' : 'Arrow keys/WASD to move',
];
function titleBubbleLayout() {
  const titleBottom = HUD_LINE + HUD_SCALE * 2 * CHARSET_SIZE + HUD_LINE;   // title's cap-top + cap-height + a margin
  const surfaceLine = CAMERA_HEIGHT / 2;
  const textW = Math.max(...BUBBLE_LINES.map(line => textWidth(line, BUBBLE_SCALE)));
  const textH = BUBBLE_LINES.length * BUBBLE_LINE;
  const w = textW + BUBBLE_PAD * 2, h = textH + BUBBLE_PAD * 2;
  const cx = CAMERA_WIDTH / 2 + CAMERA_WIDTH * 0.15, cy = (titleBottom + surfaceLine) / 2;
  // clamped, not just nudged - on a narrow viewport the unclamped centring
  // can push the box past the right edge (a long line + a % width nudge both
  // grow the overflow together); textX re-centres on the clamped box, not
  // the original cx, so the text never drifts off-centre inside it.
  const x = clamp(cx - w / 2, BUBBLE_MARGIN, CAMERA_WIDTH - BUBBLE_MARGIN - w);
  return { x, y: cy - h / 2, w, h, textX: x + w / 2 };
}

function processInputs() {
  // volume step, every screen (also the title menu's Music item). isKeyUp
  // consumes KeyM on the frame it's pressed (it releases whatever's down), so
  // the boot gates / steering never see it.
  if (isKeyUp('KeyM')) cycleVolume();

  switch (screen) {
    case TITLE_SCREEN: {
      if (titleJumping) break;   // hopping to the game-start pose - see updateTitleJump(); menu input is moot
      // a key/tap held over from reaching this screen (e.g. backing out of
      // HIGHSCORE_SCREEN) must not fall straight through to whatever menu
      // item the cursor happens to sit on - wait for a full release before
      // the menu reacts (see titleArmed).
      if (!anyKeyDown() && !isPointerDown()) titleArmed = true;
      if (!titleArmed) break;
      const items = titleMenuLayout();
      if (isKeyUp('ArrowUp')) titleIndex = (titleIndex - 1 + items.length) % items.length;
      if (isKeyUp('ArrowDown')) titleIndex = (titleIndex + 1) % items.length;
      if (isKeyUp('Enter') || isKeyUp('Space')) items[titleIndex].action();
      if (isPointerUp()) {
        const [px, py] = pointerViewportPosition();
        const hit = items.findIndex(it => px >= it.x0 && px <= it.x1 && py >= it.y0 && py <= it.y1);
        if (hit >= 0) { titleIndex = hit; items[hit].action(); }
      }
      break;
    }
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
    case HIGHSCORE_SCREEN: {
      // same release-then-fresh-press gate as titleArmed/endReady (see
      // highscoreReady above).
      if (!anyKeyDown() && !isPointerDown()) highscoreReady = true;
      if (!highscoreReady) break;
      const { rows } = highscoreLayout();
      // Up/Down/Enter navigate and replay a row - isKeyUp consumes each key
      // it fires on, so a held Up/Down/Enter can't also trip the generic
      // "any other key returns" check below on the same frame.
      if (rows.length) {
        if (isKeyUp('ArrowUp')) highscoreIndex = (highscoreIndex - 1 + rows.length) % rows.length;
        if (isKeyUp('ArrowDown')) highscoreIndex = (highscoreIndex + 1) % rows.length;
        if (isKeyUp('Enter') || isKeyUp('Space')) { selectSeed(rows[highscoreIndex].seed); break; }
      }
      if (isPointerUp()) {
        const [px, py] = pointerViewportPosition();
        const hit = rows.findIndex(r => px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1);
        if (hit >= 0) selectSeed(rows[hit].seed);
        else screen = TITLE_SCREEN;
        break;
      }
      if (anyKeyDown()) screen = TITLE_SCREEN;
      break;
    }
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
  if (screen === TITLE_SCREEN && titleJumping) updateTitleJump();
  if (screen === REWIND_SCREEN) updateRewind();
  // grow the end-of-run rainbow once the score screen is actually up (covers
  // all three ways in: resurface, rewind finishing, resize abandoning a rewind)
  if (screen === END_SCREEN) rainbowT += elapsedTime;
  // outside the screen guards: particles in flight when the run ends still
  // finish flying through the rewind and onto END_SCREEN instead of freezing.
  updateParticles();

  // swap the track when the screen has changed to one on the other side of the
  // GAME/END music split (cheap no-op otherwise; covers every screen path,
  // including the resize-abandoned rewind -> END).
  updateMusic();
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
  hero.legPhase += moved * LEG_WIGGLE;   // gait cadence rides travel distance -> speed-proportional and pause-safe (no wall-clock term)
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

  // per-seed highscore, keyed by the same "terrain-dust" string as the
  // shareable URL (runSeed, set in seedMap()) - only touches storage when
  // this run actually beats what's on record for this seed.
  const highscores = load('highscores') || {};
  const best = highscores[runSeed];
  if (!best || score > best.score) {
    highscores[runSeed] = { date: new Date().toISOString().slice(0, 10), score };
    // cap the table at HIGHSCORE_MAX entries, evicting the lowest score(s)
    // first - keeps storage and the HIGHSCORE_SCREEN table bounded without a
    // scroll/paging UI.
    const bySeed = Object.keys(highscores).sort((a, b) => highscores[b].score - highscores[a].score);
    bySeed.slice(HIGHSCORE_MAX).forEach(seed => delete highscores[seed]);
    save('highscores', highscores);
  }

  outcome = resurfaced;
  endReady = false;
  endHeld = whichKeyDown();   // steering keys still down at the stall/resurface - refreshed through the rewind (see processInputs), so END_SCREEN knows what's "leftover" vs a fresh restart press

  // Single bow: foot at the ingress mouth (trail[0]) - where the rewind lands
  // and the bow sprouts, for a stall AND a plain resurface alike. Grow timer
  // (rainbowT) is advanced per-frame in update() from the moment END_SCREEN is
  // reached, so the rewind doesn't eat the animation.
  rainbowX = trail[0];
  rainbowX2 = undefined;   // set just below only if a resurface earns the double
  rainbowT = 0;

  // dry run + resurfaced: no dust bagged means no rainbow to flood, and the
  // drill's already at the surface - there's nothing for the rewind to show
  // off. Cut straight to the score (same shortcut as a resize abandoning a
  // rewind: rewound=false, so END_SCREEN draws the drill where it surfaced).
  if (!dust && resurfaced) {
    rewound = false;
    screen = END_SCREEN;
    return;
  }

  // close the trail at the exact stop position, then rewind the camera back
  // down it - the walk-back that shows off the dig and progressively floods the
  // tunnel with rainbow (updateRewind / rewindFillI). BOTH endings get it: a
  // stall rewinds from deep up to the surface; a resurface (already at the
  // surface, at the egress hole) retraces the whole dive from egress back to
  // the ingress mouth. Speed derived from true path length (loops and all) so
  // it's ~REWIND_DURATION whatever the route.
  trail.push(...drillWorld());
  // double rainbow: a resurface that came up between RAINBOW_DOUBLE_MIN and MAX
  // of a viewport from where it went in earns a second bow. rainbowX2 = the
  // egress hole (rainbowX stays the ingress); updateRewind then lands the
  // camera on the two-hole midpoint, not the ingress mouth, so both bows frame
  // up. See renderDoubleRainbow.
  if (resurfaced) {
    const egressX = trail[trail.length - 2];
    const sep = Math.abs(egressX - trail[0]);
    if (sep > CAMERA_WIDTH * RAINBOW_DOUBLE_MIN && sep < CAMERA_WIDTH * RAINBOW_DOUBLE_MAX) rainbowX2 = egressX;
  }
  rewound = true;
  let pathLen = 0;
  for (let i = 2; i < trail.length; i += 2) {
    pathLen += Math.hypot(trail[i] - trail[i - 2], trail[i + 1] - trail[i - 1]);
  }
  rewindI = trail.length / 2 - 1;
  // rainbow fill starts at the far end, drains up behind the camera - UNLESS no
  // dust was bagged (a stall with an empty counter): rewind the camera to show
  // the dig, but flood no rainbow. 0 never chases rewindI down, so nothing fills.
  rewindFillI = dust ? rewindI : 0;
  rewindT = 0;
  rewindSkip = false;
  rewindArmed = false;
  // aim for REWIND_DURATION, but never crawl, and never jump more than a
  // half-buffer per frame (30fps worst case) or scrollMap's self-blit maths
  // would run past the buffer edge.
  rewindSpeed = clamp(pathLen / REWIND_DURATION, 600, CAMERA_WIDTH * 8);
  screen = REWIND_SCREEN;
}

// carves the tunnel each frame: a swept fixed-radius disc (per DESIGN.md:
// fixed-width tunnel, not variable) from last frame's drill centre to this
// one. A disc, not an axis-aligned box, so a diagonal doesn't carve fatter
// than a straight run; swept, not a lone stamp, so the tunnel can't gap.
function digShaft() {
  const [cx, cy] = drillWorld();                            // world-x, underground-y
  const [px, py] = prevDrill;
  // carve a capsule from last frame's drill centre to this one, not a lone
  // disc at the current point. Two gaps that stamping a single disc leaves:
  // at launch the drill sits above the surface and the first move (worse on a
  // hitched first frame) can land the disc clear of the ground, so the tunnel
  // mouth never gets cut; and mid-dive a frame hitch could step further than
  // the drill diameter. Discs along the path close both.
  const n = Math.max(1, Math.ceil(Math.hypot(cx - px, cy - py) / CELL_SIZE));
  for (let i = 1; i <= n; i++) digDisc(lerp(px, cx, i / n), lerp(py, cy, i / n));
  prevDrill = [cx, cy];
}

// dig every cell whose centre falls inside the drill disc (fixed radius per
// DESIGN.md) at (cx, cy) in world-x / underground-y. Cells above the surface
// (undergroundY < 0) are skipped - there's no terrain there to carve.
function digDisc(cx, cy) {
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
    // until the hand-off point is within the dead zone before handing off, so
    // there's no jump cut into the score screen. On a skip, don't wait:
    // hard-cut there (the skip delta from deep underground can exceed what
    // scrollMap can page). Hand-off point is the ingress mouth (trail[0]),
    // or the two-hole midpoint when a resurface earned the double rainbow.
    const hx = rainbowX2 === undefined ? trail[0] : (rainbowX + rainbowX2) / 2;
    const hy = rainbowX2 === undefined ? trail[1] : 0;
    const bx = hx - mapOffsetX, by = hy + SURFACE_Y - mapOffset;
    if (!rewindSkip &&
        Math.hypot(bx - CAMERA_WIDTH / 2 - cameraX, by - CAMERA_HEIGHT / 2 - cameraY) > CAMERA_DEADZONE) {
      centerCameraOn(bx, by, true);
      return;
    }
    // reached the surface: hard-cut there and hand off. endReady is re-cleared
    // - time passed during the rewind.
    jumpCameraTo(hx, hy);
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

// mark the dug cells near world point (wx, wy) as rainbow-filled. Gated on
// DUG.has, so FILLED is always a strict subset of DUG - a generous radius only
// ever fills real tunnel, never rock. It IS deliberately generous (a full
// drill width, 2x digShaft's radius): the trail is a coarse subsample, so on a
// rounded turn its straight chords cut inside the drilled arc and a
// drill-radius scan would miss the cells on the bulge - leaving black pixels on
// the outer edge of the bend. Adds to FILLED and stamps DUST_MASK now (buffer
// coords, as dig()); paintCell re-stamps from FILLED when a strip pages in or
// renderMap() rebuilds the mask.
function fillDust(wx, wy) {
  const r = hero.w;
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
  if (screen === REWIND_SCREEN) { screen = END_SCREEN; rewound = false; rainbowX2 = undefined; }
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
      renderDust();   // the underground dust patches near the spawn column - what Iris's bubble is asking for
      {
        const pose = titleJumpPose();
        drawHero(pose.x, pose.y, pose.angle);
      }
      // pinned near the top (not vertically centred) to leave the surface -
      // where the unicorn/Iris/speech-bubble framing will sit - clear below
      renderText('Errands of Iris', CAMERA_WIDTH / 2, HUD_LINE, ALIGN_CENTER, HUD_SCALE * 2);
      {
        const bubble = titleBubbleLayout();
        renderBubble(bubble.x, bubble.y, bubble.w, bubble.h, BUBBLE_RADIUS);
        BUBBLE_LINES.forEach((line, i) => {
          renderText(line, bubble.textX, bubble.y + BUBBLE_PAD + i * BUBBLE_LINE, ALIGN_CENTER, BUBBLE_SCALE, '#000');
        });
      }
      titleMenuLayout().forEach((item, i) => {
        if (i === titleIndex) renderText('>', item.chevronX, item.textY, ALIGN_LEFT, TITLE_MENU_SCALE);
        renderText(item.label, item.labelX, item.textY, ALIGN_LEFT, TITLE_MENU_SCALE);
      });
      // js13kgames runs entries in an iframe, hiding the URL bar (and with it
      // the ?seed= theme joke) - a small permanent corner label keeps it
      // visible regardless. Small/unobtrusive on purpose: not a menu item,
      // just a credit line.
      renderText('Seed: ' + runSeed, HUD_X, CAMERA_HEIGHT - SEED_LABEL_SCALE * CHARSET_SIZE - HUD_X, ALIGN_LEFT, SEED_LABEL_SCALE);
      break;
    case GAME_SCREEN:
      clearBuffer();
      renderDust();
      renderParticles();
      drawHero();
      renderText('Speed:', HUD_X, SPEED_VALUE_Y, ALIGN_LEFT, HUD_SCALE);
      // value drawn separately so only the number swells (2x and back) while
      // momentum sits in the overtorque band - scale tracks how far past `max`
      // it is, so the pop rides the dense-patch boost up and its bleed down.
      {
        const str = Math.round(hero.momentum / PX_PER_M) + 'm/s';
        const s = HUD_SCALE * (1 + clamp((hero.momentum - MOMENTUM.max) / (MOMENTUM.overMax - MOMENTUM.max), 0, 1));
        const cx = SPEED_VALUE_X + textWidth(str, HUD_SCALE) / 2;
        renderText(str, cx, SPEED_VALUE_Y - (s - HUD_SCALE) * CHARSET_SIZE / 2, ALIGN_CENTER, s);
      }
      renderText('Shaft:    ' + Math.round(tunnel / PX_PER_M) + 'm', HUD_X, CHARSET_SIZE + HUD_LINE, ALIGN_LEFT, HUD_SCALE);
      renderText('Dust:', HUD_X, DUST_COUNTER_Y, ALIGN_LEFT, HUD_SCALE);
      // the value briefly swells to 2x and back on each tally (see dustPop); grow about the number's own centre so it pops in place
      {
        const str = '' + dust;
        const s = HUD_SCALE * (1 + Math.sin(clamp((gameTime - dustPop) / DUST_POP_DURATION, 0, 1) * Math.PI));
        const cx = DUST_COUNTER_X + textWidth(str, HUD_SCALE) / 2;
        renderText(str, cx, DUST_COUNTER_Y - (s - HUD_SCALE) * CHARSET_SIZE / 2, ALIGN_CENTER, s);
      }
      break;
    case REWIND_SCREEN:
      // just the world, scrolling past under the camera - no HUD, no text.
      clearBuffer();
      renderDust();
      renderParticles();
      break;
    case END_SCREEN:
      // hold the world where the rewind left it (surface + tunnel mouth, or
      // the two-hole midpoint on a double) and overlay the score. The drill
      // sprite is only drawn in the one case a rewind didn't finish - a resize
      // that abandoned it - where the drill is still on screen.
      clearBuffer();
      if (rainbowX2 !== undefined) renderDoubleRainbow(rainbowX2, rainbowX);   // (egress, ingress)
      else renderRainbow(rainbowX);
      renderDust();
      renderParticles();
      if (!rewound) drawHero();
      // no win/lose split (the run just ends, see endGame()) - but a run that
      // bagged no dust grew no rainbow, so nudge the player to collect next
      // time (the headline is the CAMERA_WIDTH fit constraint, see the
      // RENDER_SCALE comment). outcome is still recorded for future share text.
      renderText(rainbowX2 !== undefined ? 'Double rainbow!' : dust ? 'Well dug!' : 'Dry run!', CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2 - 2 * HUD_LINE, ALIGN_CENTER, HUD_SCALE + 1);
      // metric lines: labels left-aligned at mx, values left-aligned at a
      // shared edge one label-field in (a proportional font won't line up on a
      // leading space, so label and value are drawn separately). mx roughly
      // centres the block.
      {
        const lw = Math.max(textWidth('Shaft:   ', HUD_SCALE), textWidth('Dust:   ', HUD_SCALE), textWidth('Score:   ', HUD_SCALE));
        const mx = CAMERA_WIDTH / 2 - (lw + textWidth('99999m', HUD_SCALE)) / 2;
        const line = (label, value, row) => {
          const y = CAMERA_HEIGHT / 2 + row * HUD_LINE;
          renderText(label, mx, y, ALIGN_LEFT, HUD_SCALE);
          renderText('' + value, mx + lw, y, ALIGN_LEFT, HUD_SCALE);
        };
        line('Shaft:', Math.round(tunnel / PX_PER_M) + 'm', 1);
        line('Dust:', dust, 2);
        line('Score:', score, 3);
      }
      if (endReady) renderText(isMobile ? 'Tap to play again' : 'Press any key to play again', CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2 + 5 * HUD_LINE, ALIGN_CENTER, HUD_SCALE);
      // renderText(monetizationEarned(), TEXT.width - CHARSET_SIZE, TEXT.height - 2*CHARSET_SIZE, ALIGN_RIGHT);
      break;
    case HIGHSCORE_SCREEN:
      // same dust/hero backdrop as TITLE_SCREEN (titleJumpT is still 0 - this
      // screen is only reachable before Start's jump fires), swapping the
      // title/bubble/menu for a heading and the score table.
      clearBuffer();
      renderDust();
      {
        const pose = titleJumpPose();
        drawHero(pose.x, pose.y, pose.angle);
      }
      renderText('Highscores', CAMERA_WIDTH / 2, HUD_LINE, ALIGN_CENTER, HUD_SCALE * 2);
      {
        const { rows, colX, top } = highscoreLayout();
        HS_HEADERS.forEach((h, c) => renderText(h, colX[c], top, ALIGN_LEFT, HS_SCALE));
        rows.forEach((r, i) => {
          if (i === highscoreIndex) renderText('>', r.chevronX, r.y0, ALIGN_LEFT, HS_SCALE);
          renderText(r.seed, colX[0], r.y0, ALIGN_LEFT, HS_SCALE);
          renderText('' + r.score, colX[1], r.y0, ALIGN_LEFT, HS_SCALE);
          renderText(r.date, colX[2], r.y0, ALIGN_LEFT, HS_SCALE);
        });
      }
      if (highscoreReady) renderText(isMobile ? 'Tap to return' : 'Press any key to return', CAMERA_WIDTH / 2, CAMERA_HEIGHT - HUD_LINE - CHARSET_SIZE * HUD_SCALE, ALIGN_CENTER, HUD_SCALE);
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

  // the floating D-pad overlay. Drawn in page px straight on the visible canvas
  // (pointerPad is page-space; the canvas has no CSS size so 1 page px == 1
  // canvas px). getBoundingClientRect places it exactly, inline-baseline gap
  // and all. Plain form: a translucent base disc stretched from the anchor out
  // to the finger + a knob disc on the finger (so the knob rides the base's
  // edge). DEBUG_POINTER swaps in the full model breakdown:
  //   - ring at RAMP = the pad radius (full deflection; anchor trails to here)
  //   - faint perpendicular bands of half-width DEAD = per-axis dead zones;
  //     drag along one and that axis snaps to pure vertical / horizontal
  //   - spoke = the actual steering direction (post dead-zone, post-saturation)
  //   - dot   = the raw finger position
  if (screen === GAME_SCREEN && isPointerDown()) {
    const [padX, padY, fingerX, fingerY, RAMP, DEAD] = pointerPad();
    const b = c.getBoundingClientRect();
    const ax = padX - b.left, ay = padY - b.top;
    const fx = fingerX - b.left, fy = fingerY - b.top;
    if (DEBUG_POINTER) {
      const [vx, vy] = pointerDirection();
      CTX.lineWidth = 2;
      CTX.fillStyle = 'rgba(255,255,255,.12)';
      CTX.fillRect(ax - DEAD, ay - RAMP, 2 * DEAD, 2 * RAMP);
      CTX.fillRect(ax - RAMP, ay - DEAD, 2 * RAMP, 2 * DEAD);
      CTX.strokeStyle = 'rgba(255,255,255,.55)';
      CTX.beginPath(); CTX.arc(ax, ay, RAMP, 0, 2 * Math.PI); CTX.stroke();
      const len = Math.hypot(vx, vy);
      if (len) {
        CTX.beginPath();
        CTX.moveTo(ax, ay);
        CTX.lineTo(ax + vx / len * RAMP, ay + vy / len * RAMP);
        CTX.stroke();
      }
      CTX.fillStyle = 'rgba(255,255,255,.55)';
      CTX.beginPath(); CTX.arc(fx, fy, 4, 0, 2 * Math.PI); CTX.fill();
    } else {
      // base: fixed size, radius = the farthest the knob centre (the finger)
      // can sit from the anchor - RAMP on each axis, so RAMP*sqrt2 diagonally.
      CTX.fillStyle = 'rgba(255,255,255,.25)';
      CTX.beginPath(); CTX.arc(ax, ay, RAMP * Math.SQRT2, 0, 2 * Math.PI); CTX.fill();
      CTX.fillStyle = 'rgba(255,255,255,.5)';    // knob on the finger
      CTX.beginPath(); CTX.arc(fx, fy, RAMP * 0.4, 0, 2 * Math.PI); CTX.fill();
    }
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

// END_SCREEN rainbow(s) (see the RAINBOW_* constants). Buffer space, ground
// line y = SURFACE_Y - mapOffset (paintCell's inverse).
//
// arcBands lays one stack of RAINBOW_BANDS concentric strokes: centre (cx,cy),
// outer radius rOut, total thickness `foot`, growing `sweep` rad from one foot
// over the apex toward the other. Drawn outer-to-inner so each band covers the
// previous stroke's AA seam. `flip` reverses the palette (violet outermost) -
// used for the double's OUTER bow, matching a real secondary rainbow: its
// colours run opposite the inner bow, so the two reds face each other across
// the gap. `fromRight` grows it from the right foot leftward instead of the
// default left foot rightward (the double's two bows grow toward each other -
// see renderDoubleRainbow).
function arcBands(cx, cy, rOut, foot, sweep, flip, fromRight) {
  const band = foot / RAINBOW_BANDS;
  BUFFER_CTX.lineCap = 'butt';
  for (let i = 0; i < RAINBOW_BANDS; i++) {
    BUFFER_CTX.strokeStyle = DUST_PALETTE[flip ? RAINBOW_BANDS - 1 - i : i];
    BUFFER_CTX.lineWidth = band + 1;                        // +1 overlap kills hairline gaps
    BUFFER_CTX.beginPath();
    const r = rOut - foot + (RAINBOW_BANDS - 0.5 - i) * band;
    if (fromRight) BUFFER_CTX.arc(cx, cy, r, 0, -sweep, true);   // right foot (0) -> apex -> left
    else BUFFER_CTX.arc(cx, cy, r, Math.PI, Math.PI + sweep);    // left foot (PI) -> apex -> right
    BUFFER_CTX.stroke();
  }
};

// the grow sweep (ease-out), off rainbowT - 0 at the anchored foot, PI at the
// far foot.
function rainbowSweep() {
  return (1 - (1 - clamp(rainbowT / RAINBOW_GROW, 0, 1)) ** 2) * Math.PI;
};

// normal single arch: left foot straddling footX, radius scaling with dust
// collected (saturating k) - dust is the whole point, so a dustless run
// sprouts nothing (see the 'dry run!' headline). Centre sits one mid-radius
// right of the foot on the ground line, so the arc climbs up-and-right.
function renderRainbow(footX) {
  if (!dust) return;
  const k = dust / (dust + RAINBOW_DUST_HALF);
  const R = lerp(RAINBOW_R_MIN, RAINBOW_R_MAX, k);
  const foot = lerp(RAINBOW_FOOT_MIN, RAINBOW_FOOT_MAX, k);
  arcBands(footX - mapOffsetX + R - foot / 2, SURFACE_Y - mapOffset, R, foot, rainbowSweep(), false, false);
};

// resurface double: two bows, each pinned by its near foot to one hole and
// growing TOWARD the other so they race up and close over the tunnel.
//   - the OUTER bow's near foot is on the EGRESS hole; slightly wider than the
//     span (RAINBOW_DOUBLE_OVERSHOOT), so its far foot lands just past ingress
//   - the INNER bow is the "primary": normal palette (red outermost), thinner,
//     drawn solid so it reads as a distinct second bow. Its near foot is on the
//     INGRESS hole; slightly narrower than the span, so its far foot lands just
//     short of egress. The OUTER bow is the "secondary": reversed palette
//     (violet outermost), so the two reds face each other across the gap.
// Radii come from the hole separation, NOT dust (a longer sideways traverse
// earns grander bows); dust drives band thickness (clamped so the stack fits
// the smaller inner arc). Mirrors cleanly whichever hole is on the left.
function renderDoubleRainbow(egressX, ingressX) {
  if (!dust) return;
  const k = dust / (dust + RAINBOW_DUST_HALF);
  const cy = SURFACE_Y - mapOffset;
  const half = Math.abs(egressX - ingressX) / 2;
  const dir = egressX < ingressX ? 1 : -1;                  // from the egress hole toward the arch centre
  const rO = half * (1 + RAINBOW_DOUBLE_OVERSHOOT);         // outer: overshoots the far hole
  const rI = half * (1 - RAINBOW_DOUBLE_OVERSHOOT);         // inner: falls short of it
  const foot = Math.min(lerp(RAINBOW_FOOT_MIN, RAINBOW_FOOT_MAX, k), rI * 0.5);
  const fs = foot * 0.55;
  const sweep = rainbowSweep();
  const egressRight = egressX > ingressX;                   // near foot side of each bow
  // outer centred one radius from the egress hole; grows from that foot
  arcBands(egressX - mapOffsetX + dir * rO, cy, rO + foot / 2, foot, sweep, true, egressRight);
  // inner centred one radius from the ingress hole; grows from that foot
  arcBands(ingressX - mapOffsetX - dir * rI, cy, rI + fs / 2, fs, sweep, false, !egressRight);
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

// stylized unicorn drilling head-first along hero.angle - rects + a triangle
// horn, drawn rigidly (no rag-doll yet). All white but the purple horn/tail.
// The whole figure corkscrews with the heading (climbing = upside down, by
// design); collision stays the plain HERO_W/H AABB, a few px of spill is fine.
// offsetX/Y (buffer-space px) and angle default to hero's own state - the
// title screen's resting/hopping unicorn is the only caller that overrides
// them (see titleJumpPose()); every other call site draws hero exactly where
// it is.
function drawHero(offsetX = 0, offsetY = 0, angle = hero.angle) {
  const ctx = BUFFER_CTX;
  ctx.save();
  ctx.translate(hero.x + hero.w / 2 + offsetX, hero.y + hero.h / 2 + offsetY);
  ctx.rotate(angle);                    // +x = drill heading / horn / dig-probe direction
  ctx.scale(1.35, 1.35);               // sprite slightly overfills the AABB - the resting silhouette just kisses the tunnel edge (feet ~15px vs the 14px radius), a hair of spill is fine

  // legs first (behind the body): slim rects swinging fore/aft, the phase wave
  // sweeping down the body reads as digging/swimming; cadence from hero.legPhase
  ctx.fillStyle = '#fff';
  const legX = [-9, -5, 2, 6];
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(legX[i], 4);
    ctx.rotate(Math.sin(hero.legPhase + i * Math.PI / 2) * 0.5);
    ctx.fillRect(-1.5, 0, 3, 7);
    ctx.restore();
  }

  // tail - purple stub off the back, sits in the already-carved tunnel
  ctx.fillStyle = UNICORN_ACCENT;
  ctx.fillRect(-18, -5, 7, 5);

  // body + head - white blocks
  ctx.fillStyle = '#fff';
  ctx.fillRect(-12, -5, 20, 11);
  ctx.fillRect(5, -8, 11, 11);

  // horn / drill - purple triangle off the forehead, biting the ground ahead
  ctx.fillStyle = UNICORN_ACCENT;
  ctx.beginPath();
  ctx.moveTo(14, -8);
  ctx.lineTo(14, -1);
  ctx.lineTo(25, -3.5);
  ctx.fill();

  ctx.restore();
}

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
    resumeAudio();               // no-op until the first gesture has unlocked it
    loop();
  } else {
    cancelAnimationFrame(requestId);
    suspendAudio();              // else the looping track plays on over a hidden/paused tab
  }
};

// EVENT HANDLERS

// Resolve the run seed and hand it to the terrain generator. One URL param
// carries both halves as "terrain-dust". No param -> the themed default
// (UNICORNS / RAINBOWS). A non-empty param is parsed and any missing half
// filled with SEED_FALLBACK, so a partial "?seed=FOO" still overrides the
// default. terrain and dust vary independently while a run stays a single
// shareable string.
const SEED_DEFAULT = ['UNICORNS', 'RAINBOWS'];
const SEED_FALLBACK = 'JS13K2026';
let runSeed;   // resolved "terrain-dust" string for this run - the highscore table key (see endGame) and the TITLE_SCREEN seed label

// fold a terrain/dust pair into the map generator, record it as runSeed, and
// reflect it in the URL so the run is shareable (guarded: some embed
// sandboxes, e.g. js13kgames' iframe, block history writes - which is also
// why runSeed gets its own on-screen label, see TITLE_SCREEN's render() case).
function applySeed(terrainStr, dustStr) {
  setMapSeed(terrainStr, dustStr);
  runSeed = `${terrainStr}-${dustStr}`;
  try {
    const url = new URL(location);
    url.searchParams.set('seed', runSeed);
    history.replaceState({}, '', url);
  } catch (e) {}
}

function seedMap() {
  const raw = new URLSearchParams(location.search).get('seed');
  let [terrainStr, dustStr] = SEED_DEFAULT;
  if (raw) {
    // uppercase before splitting - matches the all-caps look of the default/
    // fallback/rerolled seeds (see rerollSeed), so a hand-typed or
    // lower/mixed-case shared URL still reads the same on the seed label.
    const [t, d] = raw.toUpperCase().split('-');
    terrainStr = t || SEED_FALLBACK;
    dustStr = d || SEED_FALLBACK;
  }
  applySeed(terrainStr, dustStr);
}

// the real "main" of the game
onload = async (e) => {
  document.title = 'Errands of Iris';

  seedMap();
  onresize();
  seatSpawn();   // seat the title backdrop on the frame startGame() will open on
  //checkMonetization();

  tileset = await loadImg(TILESET);
  // speak = await initSpeech();
  renderMap();

  musicGame = renderSong(SONG_GAME);

  toggleLoop(true);
};

// Autoplay is blocked until a gesture: unlock the context on the first key or
// pointer press - in practice the press that fires TITLE_SCREEN's Start -
// then let updateMusic() start the track for the live screen once it lands
// on GAME_SCREEN. Recording an input isn't gameplay state, so this belongs
// in a listener.
const unlockMusic = () => {
  musicUnlocked = true;
  resumeAudio();
  updateMusic();
  removeEventListener('keydown', unlockMusic);
  removeEventListener('pointerdown', unlockMusic);
};
addEventListener('keydown', unlockMusic);
addEventListener('pointerdown', unlockMusic);

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

  // on the boot screens there's no run to preserve - re-seat the backdrop on
  // the (viewport-dependent) spawn frame so it stays matched to startGame()
  if (buffersChanged && screen < GAME_SCREEN) { seatSpawn(); renderMap(); }

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

