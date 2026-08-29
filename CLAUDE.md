 ## Orientation (read first — for a fresh session)

 `DESIGN.md` = current design (living doc, keep in sync). `TODO.md` =
 build sequencing + known bugs. Then the code that matters:

 | File | What's in it |
 |---|---|
 | `src/js/game.js` | **Everything gameplay**: RAF loop, the 3 screens (TITLE/GAME/END), `hero` state + `moveHero()` + momentum/drag + win-lose, camera follow, the `MAP` buffer paging (`scrollMap`/`paintRow`), digging (`digShaft`/`dig`/`DUG`), the dust rainbow layer (`DUST_MASK`/`DUST_GRADIENT`/`DUST_PATTERN`/`renderDust`), all rendering, input dispatch (`processInputs`). |
 | `src/js/terrain.js` | Pure procedural terrain: `sampleMaterial(x,y)` (macro sections + rock-blob pass) and `sampleDust(x,y)` → `DUST_NONE`/`SPARSE`/`DENSE` (own microgrid, wobbly patches, quarter-grid dither for sparse). `CELL_SIZE`, materials `SAND`/`CLAY`, `MATERIAL_COLOR`, `MATERIAL_DRAG`. All keyed off the stateless `hash2D` — nothing stored, recomputed on demand. |
 | `src/js/inputs/keyboard.js`, `inputs/pointer.js` | Raw input capture only (see Game engine below). `pointer.js`'s drag-direction logic is deliberately unusual — ask before touching. |
 | `src/js/text.js` | Bitmap text (`renderText`, `CHARSET_SIZE`, `ALIGN_*`). |
 | `src/js/utils.js` | Seeded PRNG, `lerp`, `clamp`, `loadImg`. |
 | `src/js/{share,storage,sound,speech,mobile,monetization}.js` | Boilerplate helpers, mostly unused so far — wire in as TODO items reach them. |

 Concepts that bite if you miss them:

 - **Two coordinate spaces.** World space (canvas pixels) vs *underground
   space* (`y - SURFACE_Y + mapOffset`). `DUG` keys and `sampleMaterial`'s
   `y` are underground-space; `hero.x/y` are world-space.
 - **`depth` is the only reliable "how far underground" measure.** Don't
   compare `hero.y` to `SURFACE_Y` — `scrollMap()` mutates `hero.y`,
   `cameraY` and `mapOffset` together, so world-space `hero.y` drifts while
   `depth` stays invariant.
 - **The `MAP` buffer is paged, never rebuilt.** `scrollMap()` self-blits by
   the scroll delta and `paintRow()` repaints only the newly exposed strip.
 - **`DUST_MASK` is a second paged buffer, in lockstep with `MAP`.** Holds
   dust-cell *shapes* only (opaque white on transparent); `scrollMap()`
   self-blits it too (with `'copy'` — it's transparent-backed, so
   source-over would ghost), `paintRow()` stamps its strip, `dig()` clears
   collected cells. `renderDust()` colours it per frame by `source-in`-
   masking a repeating diagonal rainbow tile (`DUST_PATTERN`) through it,
   offset by the camera's *underground* origin (`cy - SURFACE_Y + mapOffset`)
   so the rainbow sticks to the terrain, + a constant time phase. Gotchas:
   the camera rect must be `Math.floor`'d (dust takes an extra
   lift→colour→place round-trip `MAP` doesn't, so a fractional offset makes
   it crawl ±1px vs terrain); and it must be *one* pattern fill, not tiled
   `drawImage`s — successive `source-in` draws wipe each other.
 - **Two independent RNGs, never crossed.** `terrain.js` `hash2D` is a
   *stateless* pure hash — everything underground (terrain, dust, later
   ore) keys off it, safe to share freely since output depends only on the
   coords. `utils.js` `prng` (from `setRandSeed`) is a *stateful stream* —
   anything transient/cosmetic (particles, sound variation) draws from it
   or a fresh generator, **never** from `hash2D`. `hash2D` has no seed
   wired in yet (identical map every run); the "RNG seeds" TODO adds one.
 - **Cell-index math uses `Math.floor`, not `| 0`.** They diverge for
   negative coords (`| 0` truncates toward zero → a double-wide cell and a
   mirror seam at the origin). Harmless while everything is `x >= 0`; will
   bite when the map extends left of `x = 0` (horizontal panning).
 - **Build:** the user keeps `npm start` running in another terminal (see
   memory). Don't run `npm run build` while it's live. `npm run build:js`
   alone is a safe "does it bundle?" check.

 Leave this section better than you found it — if a fresh session would have
 been faster knowing something, add it here before `/clear`. The `/handoff`
 skill does this (plus memories, `TODO.md`, `DESIGN.md`); run it when a TODO
 item wraps or the user is about to clear.

 ## Communication style

 - Prefer diagrams over prose whenever the subject has structure: tree/parent-child
   relations, call chains, state transitions, before/after comparisons, or data flow
   between actors.
 - Use ASCII diagrams, Mermaid, or tables for these cases instead of describing
   relationships in paragraph form.
 - Draw the diagram first, then add only the prose needed to explain what the
   diagram can't carry (rationale, caveats, tradeoffs) — don't restate the
   structure in words.

## Coding style

 - When in doubt about whether an unusual pattern in this codebase is a
   mistake or intentional (e.g. for build/minification reasons), ask before
   changing it.

## Game design

 - When in doubt about a game design direction or choice (mechanics, controls,
   feel, scope of a TODO item), ask a clarifying question before implementing
   rather than guessing — saves both of us time and avoids disappointment.
   Only raise the big/consequential calls this way; don't ask about trivial
   details (constants, naming, minor tuning) that are cheap to adjust after.
 - When an implementation choice contradicts `DESIGN.md`, update the relevant
   sections of that doc directly to match what was actually built. Don't keep
   a changelog or note what changed — just make the doc describe the current
   design.

## Game engine

 - `src/js/inputs/`'s only responsibility is to record the latest raw input
   (key/pointer state, timestamps) as it arrives on the browser event thread.
   It must never apply that input to game state — no reading/writing `hero`,
   no gameplay logic, nothing heavier than storing a value. Event listeners
   run on the main/UI thread; any real work done there risks blocking it.
 - Applying recorded input to game state is `processInputs()`'s job, called
   from `update()` inside the `requestAnimationFrame` loop, never from an
   input event handler directly.
