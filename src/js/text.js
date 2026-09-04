// White system-font (Impact) text, rendered straight to an offscreen buffer
// that game.js blits over the frame. Replaces the old pixel-art charset sprite;
// the box semantics are kept identical so game.js's layout math is untouched:
// a glyph "box" is `scale * CHARSET_SIZE * FILL` px tall (cap height) with its
// top anchored at the `y` passed in.

export const ALIGN_LEFT = 0;
export const ALIGN_CENTER = 1;
export const ALIGN_RIGHT = 2;
const ALIGN = ['left', 'center', 'right'];

// layout unit game.js builds its HUD line stack, alignment offsets and particle
// targets from. Was the bitmap cell size (px); kept at 8 so none of that math
// moves when the font changes.
export const CHARSET_SIZE = 8;

// Case is the caller's choice now (the bitmap charset was single-case; a system
// font isn't, and e.g. "12m" for metres must not read as "12M" millions). Full
// character set too - no more charset-sprite repertoire limit.

const FONT = 'Impact, "Haettenschweiler", "Franklin Gothic Bold", "Arial Narrow", sans-serif';
// Impact's cap-height ink box as a multiple of the old 8px cell - the single
// knob for apparent text size. Anchoring ink-top at `y` means changing FILL
// does NOT shift the HUD line stack, so it can be tuned in isolation.
const FILL = 1;

let textCanvas;
let ctx;
let capH = 0.7;   // cap height, as an em fraction (measured from Impact)

// measure Impact's cap height once (system font - synchronously available, no
// font-load race) so renderText can size the box in px and place the baseline.
const calibrate = () => {
  ctx.font = `100px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText('HAMBURGX0369');
  capH = m.actualBoundingBoxAscent / 100;
};

export const initTextBuffer = (canvas, w, h) => {
  textCanvas = canvas.cloneNode();
  textCanvas.width = w;
  textCanvas.height = h;
  ctx = textCanvas.getContext('2d');
  calibrate();
  return textCanvas;
}

export const clearTextBuffer = () => {
  ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
}

/**
 * Render a message in Impact, sized so its cap height spans
 * `scale * CHARSET_SIZE * FILL` px with the cap top anchored at `y`. Default
 * white with a black casing (round-joined `strokeText` under the fill - no
 * backing rect, hugs the glyphs) to stay legible on any background; a
 * non-white `color` (e.g. black text on a solid bubble backing, see
 * renderBubble) skips the casing - it's already on a contrasting backing.
 * @param {string} msg
 * @param {number} x
 * @param {number} y      cap-top of the text box
 * @param {number} align  ALIGN_LEFT | ALIGN_CENTER | ALIGN_RIGHT
 * @param {number} scale  box-height multiplier (may be fractional - pop anims)
 * @param {string} color  fill color; '#fff' (default) also gets the black casing
 */
export function renderText(msg, x, y, align = ALIGN_LEFT, scale = 1, color = '#fff') {
  const box = scale * CHARSET_SIZE * FILL;
  msg = '' + msg;
  ctx.font = `${box / capH}px ${FONT}`;
  ctx.textAlign = ALIGN[align];
  ctx.textBaseline = 'alphabetic';
  if (color === '#fff') {
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.lineWidth = box / 3;               // outset ~box/6 of black around the ink
    ctx.strokeStyle = '#000';
    ctx.strokeText(msg, x, y + box);
  }
  ctx.fillStyle = color;
  ctx.fillText(msg, x, y + box);
}

/** Rendered width of `msg` at `scale`, for laying out split label/value pairs. */
export function textWidth(msg, scale = 1) {
  ctx.font = `${scale * CHARSET_SIZE * FILL / capH}px ${FONT}`;
  return ctx.measureText('' + msg).width;
}

/** Filled white rounded rect (e.g. a comic-style caption/speech-bubble backing), same buffer/space as renderText. */
export function renderBubble(x, y, w, h, r) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
