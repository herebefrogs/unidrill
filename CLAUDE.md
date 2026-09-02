 ## Orientation (read first — for a fresh session)

 `DESIGN.md` = current design (living doc, keep in sync). `TODO.md` =
 open build items + known bugs only. `CHANGELOG.md` = finished items,
 moved out of `TODO.md` as they land — **don't read it on startup**, it's a
 dead archive; `git log` is the real record, reach for `CHANGELOG.md` only
 to recover the reasoning behind one specific finished decision. Then the
 code that matters:

 | File | What's in it |
 |---|---|
 | `src/js/game.js` | **Everything gameplay**: RAF loop, the 4 screens (TITLE/GAME/REWIND/END), `hero` state + `moveHero()` + momentum/drag + win-lose + the overspeed bleed (`MOMENTUM.max`/`overMax`/`overBleed`), camera follow on both axes — a damped spring (`centerCameraOn` runs it, 120 Hz substepped) chasing a target that leads the hero by a *lagged* velocity (`followCamera` builds it: `cameraFocus`/`cameraVX`/`cameraVY` + the `CAMERA_*` block — ω/ζ/`LOOKAHEAD`/`LOOKAHEAD_LAG`/`DEADZONE`; ζ and `LOOKAHEAD` move in lockstep). Hard-lock callers (seat / `reanchorBuffer` / `jumpCameraTo` / rewind skip) pass no `smooth`. `DEBUG_CAMERA` draws a tuning ring, off. The end-of-run camera rewind (`trail`/`recordTrail`/`updateRewind`/`TRAIL_STEP`/`REWIND_DURATION` — retraces the drilled breadcrumb path back to the ingress mouth; runs for BOTH endings now, a resurface just starts at the egress hole instead of deep) and the rainbow flood it drags up the tunnel behind it (`FILLED` ⊆ `DUG` / `fillTrailSeg`/`fillDust`/`rewindFillI` — dug cells the cursor has passed; `paintCell` stamps them into `DUST_MASK` so `renderDust` gives them the dust rainbow), the END_SCREEN rainbow sprout (`renderRainbow`/`arcBands`/`RAINBOW_*`/`rainbowX`/`rainbowT` — a semicircle grown from the ingress mouth, size saturating on dust collected; no dust → no rainbow + `dry run!` headline; a resurface that pops up `RAINBOW_DOUBLE_MIN..MAX` of a viewport away from the entry gets `renderDoubleRainbow` instead — two bows, each pinned by its near foot to one hole (outer→egress, inner→ingress, radii from the hole gap ±`RAINBOW_DOUBLE_OVERSHOOT`, not dust) growing toward each other via `arcBands`'s `fromRight` flag, `rainbowX2` = egress + rewind lands on the hole midpoint), the retry gate (`endReady`/`endHeld` — a leftover held key can't lock or trigger the restart), viewport sizing (`RENDER_SCALE`/`resizeViewport`/`reanchorBuffer`), the `MAP` buffer paging in X and Y (`scrollMap`/`paintRow`/`paintCol`/`paintCell`/`clearBuffer`, `mapOffset`/`mapOffsetX`), digging (`digShaft`/`dig`/`DUG`), the dust rainbow layer (`DUST_MASK`/`DUST_GRADIENT`/`DUST_PATTERN`/`renderDust`), dust collection particles (`spawnDustParticle`/`updateParticles`/`renderParticles`), the HUD (`HUD_*`/`PX_PER_M`/`DUST_COUNTER_*`/`DUST_POP_DURATION`/`SPEED_VALUE_*`, drawn inline in `render()` — both the `dust:` and `speed:` values are drawn separately from their labels so only the number does the 2x pop), all rendering, input dispatch (`processInputs`). |
 | `src/js/terrain.js` | Pure procedural terrain: `sampleMaterial(x,y)` (macro sections + rock-blob pass) and `sampleDust(x,y)` → `DUST_NONE`/`SPARSE`/`DENSE` (own microgrid, wobbly patches, quarter-grid dither for sparse). `CELL_SIZE`, materials `SAND`/`CLAY`, `MATERIAL_COLOR`, `MATERIAL_DRAG`. All keyed off the stateless `hash2D` — nothing stored, recomputed on demand. |
 | `src/js/inputs/keyboard.js`, `inputs/pointer.js` | Raw input capture only (see Game engine below). `pointer.js` is a **floating D-pad**: an anchor at the contact point, steering vector `(finger − anchor)` per axis ramping 0→±1 over `RAMP` (55px), the anchor *trailing* the finger to stay within `RAMP` (so the pad follows the thumb), a per-axis `DEAD` (8px) zero band that also snaps near-cardinal drags to pure cardinals. Reversal only flips an axis once the finger crosses back through the trailed anchor. Exports `pointerDirection()` (the [-1,1]² vector, `game.js` normalises it — only the angle matters) and `pointerPad()` (anchor/finger/RAMP/DEAD for the overlay drawn in `game.js`, `DEBUG_POINTER` for the full breakdown). |
 | `src/js/text.js` | Bitmap text (`renderText`, `CHARSET_SIZE`, `ALIGN_*`). `renderText`'s 5th arg is an integer `scale` (HUD draws at 3). |
 | `src/js/utils.js` | Seeded PRNG, `lerp`, `clamp`, `loadImg`. |
 | `src/js/{share,storage,sound,speech,mobile,monetization}.js` | Boilerplate helpers, mostly unused so far — wire in as TODO items reach them. |

 Concepts that bite if you miss them:

 - **Two coordinate spaces, and they diverge on BOTH axes now.** Buffer
   space (where the hero is drawn, `hero.x/y`, `cameraX/Y`) vs
   *world/underground space* — world-x = `bufferX + mapOffsetX`,
   underground-y = `bufferY - SURFACE_Y + mapOffset`. `DUG` keys,
   `sampleMaterial`/`sampleDust`/`dustColorAt`/`currentDrag` args, and
   `renderDust`'s pattern anchor are all world/underground space; everything
   drawn to `BUFFER` is buffer space. `dig()`/`spawnDustParticle()` take a
   `worldX` and convert back (`- mapOffsetX`) for the draw.
 - **`depth` is the only reliable "how far underground" measure.** Don't
   compare `hero.y` to `SURFACE_Y` — `scrollMap()` mutates `hero.y`,
   `cameraY` and `mapOffset` together on a Y page (and `hero.x`, `cameraX`,
   `mapOffsetX` on an X page), so buffer-space `hero.x/y` both drift.
   `depth` stays invariant; there's no X analog yet (scoring TODO may add a
   path-length accumulator).
 - **The map is unbounded on every axis; `RENDER_SCALE` is the one size
   knob.** `RENDER_SCALE` (screen px per world px) is fixed on every device
   so sprites/HUD never shrink on a small screen. `resizeViewport()` derives
   `CAMERA_WIDTH`/`CAMERA_HEIGHT` from the live window (`window /
   RENDER_SCALE`, clamped `VIEW_MIN..VIEW_MAX`, cell-snapped) and
   *reallocates every offscreen buffer* — `BUFFER`/`MAP`/`DUST_MASK` are
   `2×CAMERA_WIDTH × 2×CAMERA_HEIGHT` (a scroll-lookahead margin each way),
   `DUST_LAYER`/`TEXT` viewport-sized; `DUST_PATTERN` and `TEXT` are `let`,
   re-created on resize. No `hero.x` clamp anywhere. `followCamera()` springs
   `cameraX`/`cameraY` toward the hero's projected focus (unclamped, fractional
   — see the camera bullet below) and, when either drifts past a buffer edge,
   `centerCameraOn()` calls `scrollMap(dx, dy)` to page that
   axis — self-blit the pixels, `mapOffsetX`/`mapOffset += delta`,
   `paintCol()`/`paintRow()` the newly exposed strip (both go through the
   shared `paintCell()`), re-seat `hero`/`camera`/stage-0 particles by the
   delta. `mapOffsetX`/`mapOffset` are kept CELL_SIZE-aligned (scroll deltas
   and `reanchorBuffer()`'s re-seat delta are all `Math.round(…/CELL)*CELL`)
   so `DUG` keys line up. `clearBuffer()` copies only the camera slice of
   `MAP`→`BUFFER` each frame (+1px for `blit`'s fractional camera).
   `reanchorBuffer()` (after a resize wipes the buffers) re-seats the hero at
   the new buffer's centre on both axes, folding the shift into
   `mapOffsetX`/`mapOffset` (world pos, hence `depth`, invariant), then
   repaints — without it a post-realloc scroll delta can exceed the buffer
   and permanently desync the offsets.
 - **The HUD reads metric; the sim is all pixels.** `depth` and
   `hero.momentum` are pixels. `PX_PER_M` (32) exists *only* to convert them
   for the on-screen readout (`depth: 12.4m`, `speed: 19m/s`) — never feed it
   back into gameplay math. HUD lines are left-aligned at `HUD_X` on purpose:
   right/centre-aligned, the labels jump around as the numbers change width.
   The `dust:` value is drawn separately from its label so only the number
   does the per-tally pop (`DUST_POP_DURATION`); the `speed:` value is split
   the same way, and swells up to 2x scaled by `(momentum - max) /
   (overMax - max)` while in the overspeed band — no timer, it just tracks
   the live value.
 - **Momentum has two caps, and they mean different things.** `MOMENTUM.max`
   (== `initial` == HUD "full speed") is the *soft* cap — where a dense-dust
   boost decays back to. `MOMENTUM.overMax` is the *hard* cap on the
   transient overshoot a boost is allowed (so the kick lands even at top
   speed). The gap between them is bled off exponentially in `moveHero()`
   (`MOMENTUM.overBleed`, ~0.25s) *on top of* normal drag — without that
   extra term `overMax` would just become the new plateau. Don't "simplify"
   by collapsing the two, and don't lower `initial` below `max` to make
   headroom — a launch speed under the cruising drag rate makes the early
   game brutally hard (playtested, rejected). See DESIGN.md Open questions.
 - **The `MAP` buffer is paged, never rebuilt.** `scrollMap(dx, dy)`
   self-blits by the scroll delta; `paintRow()` (Y page) / `paintCol()` (X
   page) repaint only the newly exposed strip. `followCamera()` passes one
   axis at a time.
 - **The camera is a damped spring toward a lagged-velocity look-ahead, not a
   lerp to the hero.** `centerCameraOn()` runs the spring (`cameraVX/VY` state,
   120 Hz substepped for stability); `followCamera()` eases `cameraFocus`
   toward the true hero velocity over `CAMERA_LOOKAHEAD_LAG` and targets
   `hero_centre + CAMERA_LOOKAHEAD·cameraFocus`. Invariants: `CAMERA_LOOKAHEAD`
   must stay `≈ 2·ζ/ω` or the cruising hero drifts off-centre (it cancels the
   spring's steady trailing lag) — **change ζ and `CAMERA_LOOKAHEAD`
   together**. `scrollMap()` leaves `cameraVX/VY`/`cameraFocus` untouched (a
   page shifts camera and target equally). Hard-lock paths (`followCamera()`
   with no arg, `jumpCameraTo()`) must zero the spring velocity and snap the
   focus. The feel spec (cruise-centred / boost-throw-then-S-curve-reel-in /
   turn-hang / rewind-loop-skip) is in DESIGN.md "Graphics — Camera tracking";
   don't retune without re-reading it. The whole thing was hard to land — many
   dead ends (1st-order lerp, dead-zone rate switch, plain spring); the
   lagged-velocity look-ahead is what made all four situations work at once.
 - **`DUST_MASK` is a second paged buffer, in lockstep with `MAP`.** Holds
   dust-cell *shapes* only (opaque white on transparent); `scrollMap()`
   self-blits it too (with `'copy'` — it's transparent-backed, so
   source-over would ghost), `paintRow()`/`paintCol()` stamp its strip,
   `dig()` clears collected cells. It also carries the end-of-run rainbow
   flood: `paintCell()` stamps a *dug* cell into it iff the cell is in
   `FILLED` (the rewind marks these as its camera passes), so the flooded
   tunnel picks up the same rainbow as dust — re-derived from `FILLED` on
   every repaint, so it survives paging and the `jumpCameraTo()`→`renderMap()`
   on the REWIND→END handoff. `renderDust()` colours it per frame by
   `source-in`-masking a repeating diagonal rainbow tile (`DUST_PATTERN`)
   through it, offset by the camera's *world/underground* origin
   (`cx + mapOffsetX`, `cy - SURFACE_Y + mapOffset`) so the rainbow sticks to
   the terrain, + a constant time phase. Gotchas: the camera rect must be
   `Math.floor`'d (dust takes an extra lift→colour→place round-trip `MAP`
   doesn't, so a fractional offset makes it crawl ±1px vs terrain) — and
   `mapOffsetX`/`mapOffset` being cell-aligned ints keeps `floor(cx) +
   mapOffsetX` exact; and it must be *one* pattern fill, not tiled
   `drawImage`s — successive `source-in` draws wipe each other.
 - **Two independent RNGs, never crossed.** `terrain.js` `hash2D` is a
   *stateless* pure hash — everything underground (terrain, dust, later
   ore) keys off it, safe to share freely since output depends only on the
   coords. `utils.js` `prng` (from `setRandSeed`) is a *stateful stream* —
   anything transient/cosmetic (particles, sound variation) draws from it
   or a fresh generator, **never** from `hash2D`. `hash2D` has no seed
   wired in yet (identical map every run); the "RNG seeds" TODO adds one.
 - **Cosmetic timing must use `gameTime`, never `currentTime`.** `currentTime`
   is raw `performance.now()` — it keeps advancing wall-clock time even
   while the RAF loop isn't running (paused, tab hidden). `gameTime` is a
   running total of `elapsedTime`, only accumulated inside `loop()`'s
   `running` guard, so pausing freezes it. Anything that animates off the
   passage of time during gameplay (the dust rainbow phase in
   `dustColorAt()`/`renderDust()`) must key off `gameTime` — using
   `currentTime` there showed up as a big colour jump on pause/resume (the
   wall-clock gap leaking into the phase).
 - **Cell-index math uses `Math.floor`, not `| 0`.** They diverge for
   negative coords (`| 0` truncates toward zero → a double-wide cell and a
   mirror seam at the origin). This is live now — world-x goes negative once
   the drill roams left of its start. `game.js` and `terrain.js` are all
   `Math.floor`; keep it that way.
 - **Build:** never run a build yourself — not `npm run build`, not
   `npm run build:js`, not `npm start`. The user keeps `npm start` running
   (a Claude Code task or a separate terminal); it watches `src/js` and
   prints esbuild errors on save. To check whether an edit compiled, read
   that task's output — ask the user to surface it if you can't reach it.
   `npm run build:js` overwrites `dist/game.js` with a terser build and
   fights the watch; `npm run build` also runs `clean` (`rm -rf dist`),
   which silently kills the running watch. See memory for the full picture.

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
