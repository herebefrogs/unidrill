import { isKeyDown, anyKeyDown, isKeyUp } from './inputs/keyboard';
import { isPointerDown, isPointerUp, pointerCanvasPosition, pointerDirection } from './inputs/pointer';
import { isMobile } from './mobile';
import { checkMonetization, isMonetizationEnabled } from './monetization';
import { share } from './share';
import { loadSongs, playSound, playSong } from './sound';
import { initSpeech } from './speech';
import { save, load } from './storage';
import { ALIGN_LEFT, ALIGN_CENTER, ALIGN_RIGHT, CHARSET_SIZE, initCharset, renderText, initTextBuffer, clearTextBuffer, renderAnimatedText } from './text';
import { getRandSeed, setRandSeed, loadImg } from './utils';
import { CELL_SIZE, sampleMaterial, materialColor } from './terrain';
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

const HERO_W = 24;                             // temporary blue square, real sprite later
const HERO_H = 24;
const HERO_SPEED = 200;                        // px/sec, constant forward thrust along hero.angle
const TURN_SPEED = Math.PI;                    // radians/sec the drill can bank left/right

let hero;
let depth;                                     // px drilled below the surface (world-space y, until infinite scroll lands)

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
};
depth = 0;
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
const TEXT = initTextBuffer(c, CAMERA_WIDTH, CAMERA_HEIGHT);  // text buffer


const ATLAS = {};
const FRAME_DURATION = 0.1; // duration of 1 animation frame, in seconds
let tileset;   // characters sprite, embedded as a base64 encoded dataurl by build script

// LOOP VARIABLES

let currentTime;
let elapsedTime;
let lastTime;
let requestId;
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
  };
  depth = 0;
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
    case GAME_SCREEN:
      // drill always thrusts forward along hero.angle (see moveHero) -
      // there's no throttle. Left/right bank the angle by a rate; a pointer
      // drag replaces the angle outright with the drag direction.
      if (isPointerDown()) {
        const [vX, vY] = pointerDirection();
        if (vX || vY) hero.angle = Math.atan2(vY, vX);
      } else {
        hero.moveLeft = isKeyDown(
          'ArrowLeft',
          'KeyA',   // English Keyboard layout
          'KeyQ'    // French keyboard layout
        );
        hero.moveRight = isKeyDown(
          'ArrowRight',
          'KeyD'
        );
        if (hero.moveLeft) hero.angle -= TURN_SPEED * elapsedTime;
        if (hero.moveRight) hero.angle += TURN_SPEED * elapsedTime;
      }
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
      if (anyKeyDown() || isPointerUp()) {
        screen = TITLE_SCREEN;
      }
      break;
  }
}

function update() {
  processInputs();

  if (screen === GAME_SCREEN) {
    moveHero();
    digShaft();
    followCamera();
  }
};

function moveHero() {
  // constant forward thrust along hero.angle - no throttle control (see
  // processInputs); item 7 (momentum/drag) will modulate this later.
  hero.velX = Math.cos(hero.angle);
  hero.velY = Math.sin(hero.angle);
  hero.x += hero.velX * HERO_SPEED * elapsedTime;
  hero.y += hero.velY * HERO_SPEED * elapsedTime;
  // temporary: clamp to the (currently x-locked) camera width instead of the
  // full map width - there's no horizontal camera panning yet, and proper
  // edge collision is TODO item 6, this just stops the hero drilling off
  // both sides of the visible viewport.
  hero.x = Math.max(0, Math.min(CAMERA_WIDTH - hero.w, hero.x));
  // temporary: floor at the surface - no resurface/win-condition exists yet
  // to make "going back above ground" meaningful, so just block it, same as
  // the old depth-gated moveUp check but expressed as a position clamp since
  // there's no discrete "moveUp" input anymore (angle can point anywhere).
  hero.y = Math.max(SURFACE_Y - hero.h, hero.y);
  depth = Math.max(0, Math.round(hero.y + hero.h - SURFACE_Y + mapOffset));
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
  if (dy > 0) {
    MAP_CTX.drawImage(MAP, 0, dy, MAP.width, MAP.height - dy, 0, 0, MAP.width, MAP.height - dy);
    mapOffset += dy;
    for (let y = MAP.height - dy; y < MAP.height; y += CELL_SIZE) paintRow(y);
  } else {
    MAP_CTX.drawImage(MAP, 0, 0, MAP.width, MAP.height + dy, 0, -dy, MAP.width, MAP.height + dy);
    mapOffset += dy;
    for (let y = 0; y < -dy; y += CELL_SIZE) paintRow(y);
  }
  hero.y -= dy;
  cameraY -= dy;
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
      BUFFER_CTX.fillStyle = '#2255ee';
      BUFFER_CTX.fillRect(hero.x, hero.y, hero.w, hero.h);
      renderText('game screen', CHARSET_SIZE, CHARSET_SIZE);
      renderText('depth ' + depth, CAMERA_WIDTH - CHARSET_SIZE, CHARSET_SIZE, ALIGN_RIGHT);
      // debugCameraWindow();
      // uncomment to debug mobile input handlers
      // renderDebugTouch();
      break;
    case END_SCREEN:
      BUFFER_CTX.fillStyle = '#fff';
      BUFFER_CTX.fillRect(0, 0, BUFFER.width, BUFFER.height);
      renderText('end screen', CHARSET_SIZE, CHARSET_SIZE);
      // renderText(monetizationEarned(), TEXT.width - CHARSET_SIZE, TEXT.height - 2*CHARSET_SIZE, ALIGN_RIGHT);
      break;
  }

  blit();
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
  for (let x = 0; x < MAP.width; x += CELL_SIZE) {
    MAP_CTX.fillStyle = underground < 0 ? SKY_COLOR : DUG.has(x + '_' + underground) ? TUNNEL_COLOR : materialColor(sampleMaterial(x, underground));
    MAP_CTX.fillRect(x, y, CELL_SIZE, CELL_SIZE);
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
  CTX.imageSmoothingEnabled = MAP_CTX.imageSmoothingEnabled = BUFFER_CTX.imageSmoothingEnabled = false;

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

